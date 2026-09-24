<?php
/**
 * Discussions module: comments and issues on posts, pages and custom post types.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Lets the people who can edit a post discuss it like a shared document: leave
 * comments, raise issues and assign them, @mention people, reply, and resolve. A
 * thread can be attached to a block, which is marked in the editor.
 *
 * Threads and replies are stored as meta on the post, so they never appear on the
 * site, in comment counts or on the Comments screen.
 */
class NoteFlow_Module_Discussions {

	const THREAD = '_noteflow_thread';
	const REPLY  = '_noteflow_reply';
	const OPEN   = '_noteflow_open_threads';

	const MAX_TEXT = 5000;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
		add_action( 'enqueue_block_editor_assets', array( __CLASS__, 'block_editor_assets' ) );
		add_action( 'enqueue_block_assets', array( __CLASS__, 'canvas_styles' ) );
		add_action( 'admin_init', array( __CLASS__, 'list_columns' ) );
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_meta_box' ), 10, 2 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'classic_editor_assets' ) );
	}

	/**
	 * Post types NoteFlow appears on, in the editor.
	 *
	 * @return string[]
	 */
	public static function post_types() {
		return (array) NoteFlow_Settings::get( 'content_post_types' );
	}

	/**
	 * Whether the current user can take part in a post's discussion.
	 *
	 * @param WP_Post|null $post Post.
	 * @return bool
	 */
	public static function can_discuss( $post ) {
		return $post instanceof WP_Post
			&& in_array( $post->post_type, self::post_types(), true )
			&& NoteFlow_Access::can_use()
			&& current_user_can( 'edit_post', $post->ID );
	}

	/**
	 * Whether the current user may delete someone else's thread or reply on this post.
	 *
	 * @param WP_Post $post Post.
	 * @return bool
	 */
	private static function can_moderate( $post ) {
		$type = get_post_type_object( $post->post_type );
		return get_current_user_id() === (int) $post->post_author
			|| ( $type && current_user_can( $type->cap->edit_others_posts ) )
			|| current_user_can( 'manage_options' );
	}

	/* Storage ------------------------------------------------------------------------------ */

	/**
	 * Meta rows of one key, with their IDs, oldest first.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $key     Meta key.
	 * @return array<int,array> Meta ID => value.
	 */
	private static function rows( $post_id, $key ) {
		global $wpdb;
		$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare( "SELECT meta_id, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s ORDER BY meta_id ASC", $post_id, $key )
		);
		$out  = array();
		foreach ( $rows as $row ) {
			$value = maybe_unserialize( $row->meta_value );
			if ( is_array( $value ) ) {
				$out[ (int) $row->meta_id ] = $value;
			}
		}
		return $out;
	}

	/**
	 * A thread as the editor sees it.
	 *
	 * @param int   $id      Thread ID.
	 * @param array $thread  Stored thread.
	 * @param array $replies Its replies, keyed by ID.
	 * @return array
	 */
	private static function format( $id, $thread, $replies ) {
		$out = array();
		foreach ( $replies as $rid => $reply ) {
			$out[] = array(
				'id'       => $rid,
				'author'   => (int) $reply['user'],
				'text'     => (string) $reply['text'],
				'time'     => (int) $reply['time'],
				'mentions' => array_map( 'intval', isset( $reply['mentions'] ) ? (array) $reply['mentions'] : array() ),
			);
		}
		return array(
			'id'         => $id,
			'type'       => 'issue' === ( $thread['type'] ?? '' ) ? 'issue' : 'comment',
			'text'       => (string) ( $thread['text'] ?? '' ),
			'author'     => (int) ( $thread['user'] ?? 0 ),
			'time'       => (int) ( $thread['time'] ?? 0 ),
			'status'     => 'resolved' === ( $thread['status'] ?? '' ) ? 'resolved' : 'open',
			'assignee'   => (int) ( $thread['assignee'] ?? 0 ),
			'block'      => (string) ( $thread['block'] ?? '' ),
			'quote'      => (string) ( $thread['quote'] ?? '' ),
			'mentions'   => array_map( 'intval', isset( $thread['mentions'] ) ? (array) $thread['mentions'] : array() ),
			'resolvedBy' => (int) ( $thread['resolved_by'] ?? 0 ),
			'resolvedAt' => (int) ( $thread['resolved_at'] ?? 0 ),
			'replies'    => $out,
		);
	}

	/**
	 * Every thread on a post, newest first, with replies oldest first.
	 *
	 * @param int $post_id Post ID.
	 * @return array[]
	 */
	public static function threads( $post_id ) {
		$replies = array();
		foreach ( self::rows( $post_id, self::REPLY ) as $rid => $reply ) {
			$replies[ (int) ( $reply['thread'] ?? 0 ) ][ $rid ] = $reply;
		}
		$threads = array();
		foreach ( self::rows( $post_id, self::THREAD ) as $id => $thread ) {
			$threads[] = self::format( $id, $thread, $replies[ $id ] ?? array() );
		}
		return array_reverse( $threads );
	}

	/**
	 * Loads one thread of a post.
	 *
	 * @param int $post_id   Post ID.
	 * @param int $thread_id Thread ID.
	 * @return array|null Stored thread.
	 */
	private static function stored( $post_id, $thread_id ) {
		$meta = get_metadata_by_mid( 'post', (int) $thread_id );
		if ( ! $meta || (int) $meta->post_id !== (int) $post_id || self::THREAD !== $meta->meta_key || ! is_array( $meta->meta_value ) ) {
			return null;
		}
		return $meta->meta_value;
	}

	/**
	 * Keeps the open-thread count for the posts list.
	 *
	 * @param int $post_id Post ID.
	 */
	private static function recount( $post_id ) {
		$open = 0;
		foreach ( self::rows( $post_id, self::THREAD ) as $thread ) {
			if ( 'resolved' !== ( $thread['status'] ?? '' ) ) {
				++$open;
			}
		}
		if ( $open ) {
			update_post_meta( $post_id, self::OPEN, $open );
		} else {
			delete_post_meta( $post_id, self::OPEN );
		}
	}

	/**
	 * Cleans comment text.
	 *
	 * @param string $text Raw text.
	 * @return string
	 */
	private static function clean_text( $text ) {
		$text = trim( sanitize_textarea_field( (string) $text ) );
		return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, self::MAX_TEXT ) : substr( $text, 0, self::MAX_TEXT );
	}

	/**
	 * Mentioned or assigned people who can take part, minus the person writing.
	 *
	 * @param int   $post_id Post ID.
	 * @param int[] $ids     User IDs.
	 * @return int[]
	 */
	private static function participants( $post_id, $ids ) {
		$me = get_current_user_id();
		return array_values(
			array_filter(
				array_unique( array_map( 'intval', (array) $ids ) ),
				function ( $uid ) use ( $post_id, $me ) {
					return $uid && $uid !== $me && user_can( $uid, 'edit_post', $post_id ) && NoteFlow_Access::can_use( $uid );
				}
			)
		);
	}

	/* REST ------------------------------------------------------------------------------------ */

	/**
	 * Registers the routes.
	 */
	public static function routes() {
		$base = '/posts/(?P<post>\d+)';
		$map  = array(
			array( $base . '/threads', 'GET', 'list_threads' ),
			array( $base . '/threads', 'POST', 'create_thread' ),
			array( $base . '/threads/(?P<thread>\d+)', 'POST', 'update_thread' ),
			array( $base . '/threads/(?P<thread>\d+)', 'DELETE', 'delete_thread' ),
			array( $base . '/threads/(?P<thread>\d+)/replies', 'POST', 'add_reply' ),
			array( $base . '/replies/(?P<reply>\d+)', 'DELETE', 'delete_reply' ),
			array( $base . '/people', 'GET', 'people' ),
			array( $base . '/notes', 'GET', 'notes' ),
		);
		foreach ( $map as $route ) {
			register_rest_route(
				NoteFlow_REST::NS,
				$route[0],
				array(
					'methods'             => $route[1],
					'callback'            => array( __CLASS__, $route[2] ),
					'permission_callback' => array( __CLASS__, 'permission' ),
				)
			);
		}
	}

	/**
	 * Every route: a NoteFlow user who can edit the post.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public static function permission( WP_REST_Request $request ) {
		$ok = NoteFlow_REST::permission();
		if ( is_wp_error( $ok ) ) {
			return $ok;
		}
		if ( ! self::can_discuss( get_post( (int) $request['post'] ) ) ) {
			return new WP_Error( 'noteflow_forbidden', __( 'You cannot discuss this item.', 'noteflow' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * The discussion, with counts and the people in it.
	 *
	 * @param int $post_id Post ID.
	 * @return array
	 */
	private static function payload( $post_id ) {
		$threads = self::threads( $post_id );
		$ids     = array();
		$open    = 0;
		foreach ( $threads as $thread ) {
			$ids[] = $thread['author'];
			$ids[] = $thread['assignee'];
			$ids[] = $thread['resolvedBy'];
			foreach ( $thread['replies'] as $reply ) {
				$ids[] = $reply['author'];
			}
			if ( 'open' === $thread['status'] ) {
				++$open;
			}
		}
		return array(
			'threads' => $threads,
			'people'  => NoteFlow_Notes::people( $ids ),
			'counts'  => array(
				'open'     => $open,
				'resolved' => count( $threads ) - $open,
			),
		);
	}

	/**
	 * GET /posts/{post}/threads
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function list_threads( WP_REST_Request $request ) {
		return self::payload( (int) $request['post'] );
	}

	/**
	 * POST /posts/{post}/threads — starts a comment or an issue.
	 *
	 * @param WP_REST_Request $request Request with type, text, mentions, assignee, block, quote.
	 * @return array|WP_Error
	 */
	public static function create_thread( WP_REST_Request $request ) {
		$post = get_post( (int) $request['post'] );
		$text = self::clean_text( $request->get_param( 'text' ) );
		if ( '' === $text ) {
			return new WP_Error( 'noteflow_comment_empty', __( 'Write something first.', 'noteflow' ), array( 'status' => 400 ) );
		}

		$type     = 'issue' === $request->get_param( 'type' ) ? 'issue' : 'comment';
		$assignee = self::participants( $post->ID, array( (int) $request->get_param( 'assignee' ) ) );
		$mentions = self::participants( $post->ID, (array) $request->get_param( 'mentions' ) );
		$quote    = trim( sanitize_text_field( (string) $request->get_param( 'quote' ) ) );
		$block    = preg_replace( '/[^a-z0-9-]/', '', strtolower( (string) $request->get_param( 'block' ) ) );
		$me       = get_current_user_id();

		$id = add_post_meta(
			$post->ID,
			self::THREAD,
			array(
				'type'     => $type,
				'text'     => $text,
				'user'     => $me,
				'time'     => time(),
				'status'   => 'open',
				'assignee' => 'issue' === $type && $assignee ? $assignee[0] : 0,
				'block'    => substr( $block, 0, 40 ),
				'quote'    => function_exists( 'mb_substr' ) ? mb_substr( $quote, 0, 160 ) : substr( $quote, 0, 160 ),
				'mentions' => $mentions,
			)
		);
		if ( ! $id ) {
			return new WP_Error( 'noteflow_comment_failed', __( 'The comment could not be saved.', 'noteflow' ), array( 'status' => 500 ) );
		}
		self::recount( $post->ID );

		// Tell the assignee, the people mentioned, and the post's author.
		$told = array( $me );
		if ( 'issue' === $type && $assignee ) {
			NoteFlow_Notifications::add( $assignee[0], 'post_assign', $post->ID, $me, $text, array( 'thread' => $id ) );
			$told[] = $assignee[0];
		}
		foreach ( array_diff( $mentions, $told ) as $uid ) {
			NoteFlow_Notifications::add( $uid, 'post_mention', $post->ID, $me, $text, array( 'thread' => $id ) );
			$told[] = $uid;
		}
		$author = (int) $post->post_author;
		if ( ! in_array( $author, $told, true ) && NoteFlow_Access::can_use( $author ) ) {
			NoteFlow_Notifications::add( $author, 'issue' === $type ? 'post_issue' : 'post_comment', $post->ID, $me, $text, array( 'thread' => $id ) );
		}

		return self::payload( $post->ID ) + array( 'created' => (int) $id );
	}

	/**
	 * POST /posts/{post}/threads/{thread} — resolves, reopens or reassigns.
	 *
	 * @param WP_REST_Request $request Request with status and/or assignee.
	 * @return array|WP_Error
	 */
	public static function update_thread( WP_REST_Request $request ) {
		$post   = get_post( (int) $request['post'] );
		$tid    = (int) $request['thread'];
		$thread = self::stored( $post->ID, $tid );
		if ( ! $thread ) {
			return new WP_Error( 'noteflow_thread_missing', __( 'That discussion no longer exists.', 'noteflow' ), array( 'status' => 404 ) );
		}
		$me = get_current_user_id();

		if ( $request->has_param( 'status' ) ) {
			$resolve = 'resolved' === $request->get_param( 'status' );
			if ( $resolve && 'resolved' !== ( $thread['status'] ?? '' ) ) {
				$thread['status']      = 'resolved';
				$thread['resolved_by'] = $me;
				$thread['resolved_at'] = time();
				$owner                 = (int) ( $thread['user'] ?? 0 );
				if ( $owner && $owner !== $me ) {
					NoteFlow_Notifications::add( $owner, 'post_resolved', $post->ID, $me, (string) ( $thread['text'] ?? '' ), array( 'thread' => $tid ) );
				}
			} elseif ( ! $resolve ) {
				$thread['status']      = 'open';
				$thread['resolved_by'] = 0;
				$thread['resolved_at'] = 0;
			}
		}

		if ( $request->has_param( 'assignee' ) ) {
			$assignee           = self::participants( $post->ID, array( (int) $request->get_param( 'assignee' ) ) );
			$previous           = (int) ( $thread['assignee'] ?? 0 );
			$thread['type']     = 'issue';
			$thread['assignee'] = $assignee ? $assignee[0] : 0;
			if ( $assignee && $assignee[0] !== $previous ) {
				NoteFlow_Notifications::add( $assignee[0], 'post_assign', $post->ID, $me, (string) ( $thread['text'] ?? '' ), array( 'thread' => $tid ) );
			}
		}

		update_metadata_by_mid( 'post', $tid, $thread );
		self::recount( $post->ID );
		return self::payload( $post->ID );
	}

	/**
	 * DELETE /posts/{post}/threads/{thread} — its writer or a moderator can delete it.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function delete_thread( WP_REST_Request $request ) {
		$post   = get_post( (int) $request['post'] );
		$tid    = (int) $request['thread'];
		$thread = self::stored( $post->ID, $tid );
		if ( ! $thread ) {
			return new WP_Error( 'noteflow_thread_missing', __( 'That discussion no longer exists.', 'noteflow' ), array( 'status' => 404 ) );
		}
		if ( (int) ( $thread['user'] ?? 0 ) !== get_current_user_id() && ! self::can_moderate( $post ) ) {
			return new WP_Error( 'noteflow_forbidden', __( 'You can only delete your own comments.', 'noteflow' ), array( 'status' => 403 ) );
		}

		foreach ( self::rows( $post->ID, self::REPLY ) as $rid => $reply ) {
			if ( (int) ( $reply['thread'] ?? 0 ) === $tid ) {
				delete_metadata_by_mid( 'post', $rid );
			}
		}
		delete_metadata_by_mid( 'post', $tid );
		self::recount( $post->ID );
		return self::payload( $post->ID );
	}

	/**
	 * POST /posts/{post}/threads/{thread}/replies
	 *
	 * @param WP_REST_Request $request Request with text and mentions.
	 * @return array|WP_Error
	 */
	public static function add_reply( WP_REST_Request $request ) {
		$post   = get_post( (int) $request['post'] );
		$tid    = (int) $request['thread'];
		$thread = self::stored( $post->ID, $tid );
		if ( ! $thread ) {
			return new WP_Error( 'noteflow_thread_missing', __( 'That discussion no longer exists.', 'noteflow' ), array( 'status' => 404 ) );
		}
		$text = self::clean_text( $request->get_param( 'text' ) );
		if ( '' === $text ) {
			return new WP_Error( 'noteflow_comment_empty', __( 'Write something first.', 'noteflow' ), array( 'status' => 400 ) );
		}

		$me       = get_current_user_id();
		$mentions = self::participants( $post->ID, (array) $request->get_param( 'mentions' ) );
		add_post_meta(
			$post->ID,
			self::REPLY,
			array(
				'thread'   => $tid,
				'user'     => $me,
				'text'     => $text,
				'time'     => time(),
				'mentions' => $mentions,
			)
		);

		// A reply to a resolved thread opens it again.
		if ( 'resolved' === ( $thread['status'] ?? '' ) ) {
			$thread['status']      = 'open';
			$thread['resolved_by'] = 0;
			$thread['resolved_at'] = 0;
			update_metadata_by_mid( 'post', $tid, $thread );
			self::recount( $post->ID );
		}

		// Tell the people mentioned, then everyone else in the thread.
		$told = array( $me );
		foreach ( $mentions as $uid ) {
			NoteFlow_Notifications::add( $uid, 'post_mention', $post->ID, $me, $text, array( 'thread' => $tid ) );
			$told[] = $uid;
		}
		$involved = array( (int) ( $thread['user'] ?? 0 ), (int) ( $thread['assignee'] ?? 0 ) );
		foreach ( self::rows( $post->ID, self::REPLY ) as $reply ) {
			if ( (int) ( $reply['thread'] ?? 0 ) === $tid ) {
				$involved[] = (int) $reply['user'];
			}
		}
		foreach ( array_diff( self::participants( $post->ID, $involved ), $told ) as $uid ) {
			NoteFlow_Notifications::add( $uid, 'post_reply', $post->ID, $me, $text, array( 'thread' => $tid ) );
		}

		return self::payload( $post->ID );
	}

	/**
	 * DELETE /posts/{post}/replies/{reply}
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function delete_reply( WP_REST_Request $request ) {
		$post = get_post( (int) $request['post'] );
		$meta = get_metadata_by_mid( 'post', (int) $request['reply'] );
		if ( ! $meta || (int) $meta->post_id !== $post->ID || self::REPLY !== $meta->meta_key ) {
			return new WP_Error( 'noteflow_reply_missing', __( 'That reply no longer exists.', 'noteflow' ), array( 'status' => 404 ) );
		}
		$reply = is_array( $meta->meta_value ) ? $meta->meta_value : array();
		if ( (int) ( $reply['user'] ?? 0 ) !== get_current_user_id() && ! self::can_moderate( $post ) ) {
			return new WP_Error( 'noteflow_forbidden', __( 'You can only delete your own comments.', 'noteflow' ), array( 'status' => 403 ) );
		}
		delete_metadata_by_mid( 'post', (int) $request['reply'] );
		return self::payload( $post->ID );
	}

	/**
	 * GET /posts/{post}/people — people who can take part, for @mentions and assigning.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function people( WP_REST_Request $request ) {
		$post_id = (int) $request['post'];
		$ids     = get_users(
			array(
				'role__in' => NoteFlow_Access::allowed_roles(),
				'number'   => 200,
				'orderby'  => 'display_name',
				'fields'   => 'ID',
			)
		);
		$ids     = array_filter(
			array_map( 'intval', $ids ),
			function ( $uid ) use ( $post_id ) {
				return user_can( $uid, 'edit_post', $post_id ) && NoteFlow_Access::can_use( $uid );
			}
		);
		return array( 'people' => array_values( NoteFlow_Notes::people( $ids ) ) );
	}

	/**
	 * GET /posts/{post}/notes — notes attached to the post that the user can open.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function notes( WP_REST_Request $request ) {
		$uid   = get_current_user_id();
		$notes = array();
		if ( NoteFlow_Settings::module_enabled( 'content_notes' ) ) {
			foreach ( NoteFlow_Module_Content_Notes::notes_for( (int) $request['post'], $uid ) as $note ) {
				$summary         = NoteFlow_Notes::summary( $note, $uid );
				$summary['url']  = NoteFlow_Admin::note_url( $note->ID );
				$summary['when'] = human_time_diff( $summary['modified'] );
				$notes[]         = $summary;
			}
		}
		return array( 'notes' => $notes );
	}

	/* Editor ---------------------------------------------------------------------------------- */

	/**
	 * Data for the discussion panel.
	 *
	 * @param WP_Post $post Post.
	 * @return array
	 */
	public static function panel_data( $post ) {
		$user = wp_get_current_user();
		return array(
			'post'        => $post->ID,
			'me'          => (int) $user->ID,
			'people'      => NoteFlow_Notes::people( array( $user->ID ) ),
			'moderate'    => self::can_moderate( $post ),
			'discussions' => NoteFlow_Settings::module_enabled( 'discussions' ),
			'notes'       => NoteFlow_Settings::module_enabled( 'content_notes' ),
			'app'         => admin_url( 'admin.php?page=' . NoteFlow_Admin::PAGE ),
			'thread'      => isset( $_GET['nf_thread'] ) ? absint( $_GET['nf_thread'] ) : 0, // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only deep link.
			'focus'       => isset( $_GET['nf_thread'] ), // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only deep link.
			'type'        => get_post_type_object( $post->post_type )->labels->singular_name,
		);
	}

	/**
	 * Registers the panel script and styles, shared by both editors.
	 */
	public static function register_assets() {
		wp_register_style( 'noteflow-discussions', NOTEFLOW_URL . 'assets/css/discussions.css', array(), NOTEFLOW_VERSION );
		wp_register_script( 'noteflow-discussions', NOTEFLOW_URL . 'assets/js/discussions.js', array( 'wp-api-fetch', 'wp-i18n' ), NOTEFLOW_VERSION, true );
		wp_set_script_translations( 'noteflow-discussions', 'noteflow', NOTEFLOW_DIR . 'languages' );
	}

	/**
	 * The NoteFlow sidebar, block toolbar button and block highlights in the block editor.
	 */
	public static function block_editor_assets() {
		$post = get_post();
		if ( ! self::can_discuss( $post ) ) {
			return;
		}
		self::register_assets();
		wp_enqueue_style( 'noteflow-discussions' );
		wp_enqueue_script(
			'noteflow-block-editor',
			NOTEFLOW_URL . 'assets/js/block-editor.js',
			array( 'noteflow-discussions', 'wp-plugins', 'wp-element', 'wp-dom-ready', 'wp-components', 'wp-data', 'wp-hooks', 'wp-compose', 'wp-block-editor', 'wp-blocks', 'wp-editor', 'wp-edit-post', 'wp-i18n' ),
			NOTEFLOW_VERSION,
			true
		);
		wp_set_script_translations( 'noteflow-block-editor', 'noteflow', NOTEFLOW_DIR . 'languages' );
		wp_add_inline_script( 'noteflow-discussions', 'window.noteflowDiscussion = ' . wp_json_encode( self::panel_data( $post ) ) . ';', 'before' );
	}

	/**
	 * The NoteFlow box in the classic editor. The block editor has the sidebar instead.
	 *
	 * @param string  $post_type Post type.
	 * @param WP_Post $post      Post being edited.
	 */
	public static function add_meta_box( $post_type, $post ) {
		if ( ! self::can_discuss( $post ) ) {
			return;
		}
		add_meta_box(
			'noteflow-discussion',
			__( 'NoteFlow', 'noteflow' ),
			array( __CLASS__, 'render_meta_box' ),
			$post_type,
			'side',
			'high',
			array( '__back_compat_meta_box' => true )
		);
	}

	/**
	 * Renders the box. The discussion script fills it.
	 */
	public static function render_meta_box() {
		echo '<div id="noteflow-discussion-root" class="nfd-classic"><p class="nfd-loading">' . esc_html__( 'Loading…', 'noteflow' ) . '</p></div>';
	}

	/**
	 * The discussion script and styles in the classic editor.
	 *
	 * @param string $hook Current admin page.
	 */
	public static function classic_editor_assets( $hook ) {
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}
		$screen = get_current_screen();
		$post   = get_post();
		if ( ! $screen || $screen->is_block_editor() || ! self::can_discuss( $post ) ) {
			return;
		}
		self::register_assets();
		wp_enqueue_style( 'noteflow-discussions' );
		wp_enqueue_script( 'noteflow-discussions' );
		wp_add_inline_script( 'noteflow-discussions', 'window.noteflowDiscussion = ' . wp_json_encode( self::panel_data( $post ) ) . ';', 'before' );
	}

	/**
	 * Marks blocks that have open threads, inside the editor canvas.
	 */
	public static function canvas_styles() {
		if ( ! is_admin() ) {
			return;
		}
		wp_register_style( 'noteflow-canvas', false, array(), NOTEFLOW_VERSION );
		wp_enqueue_style( 'noteflow-canvas' );
		wp_add_inline_style(
			'noteflow-canvas',
			'.nf-has-discussion{background-color:rgba(245,189,31,.14);box-shadow:-5px 0 0 0 #f5bd1f;border-radius:0 3px 3px 0}' .
			'.nf-has-discussion.is-selected,.nf-has-discussion.has-child-selected{background-color:rgba(245,189,31,.22)}'
		);
	}

	/* Posts list ------------------------------------------------------------------------------ */

	/**
	 * Adds the Discussion column to the lists of enabled post types.
	 */
	public static function list_columns() {
		if ( ! NoteFlow_Access::can_use() ) {
			return;
		}
		foreach ( self::post_types() as $type ) {
			add_filter( "manage_{$type}_posts_columns", array( __CLASS__, 'add_column' ) );
			add_action( "manage_{$type}_posts_custom_column", array( __CLASS__, 'render_column' ), 10, 2 );
		}
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'column_styles' ) );
	}

	/**
	 * The column.
	 *
	 * @param string[] $columns Columns.
	 * @return string[]
	 */
	public static function add_column( $columns ) {
		$columns['noteflow'] = esc_html__( 'NoteFlow', 'noteflow' );
		return $columns;
	}

	/**
	 * A post's open thread count.
	 *
	 * @param string $column  Column.
	 * @param int    $post_id Post ID.
	 */
	public static function render_column( $column, $post_id ) {
		if ( 'noteflow' !== $column ) {
			return;
		}
		$open = (int) get_post_meta( $post_id, self::OPEN, true );
		if ( ! $open || ! current_user_can( 'edit_post', $post_id ) ) {
			echo '<span aria-hidden="true">&#8212;</span>';
			return;
		}
		printf(
			'<a class="nf-col-open" href="%1$s" title="%2$s">%3$s</a>',
			esc_url( add_query_arg( 'nf_thread', 'open', get_edit_post_link( $post_id, 'raw' ) ) ),
			/* translators: %s: number of open comments and issues. */
			esc_attr( sprintf( _n( '%s open comment or issue', '%s open comments and issues', $open, 'noteflow' ), number_format_i18n( $open ) ) ),
			/* translators: %s: number of open comments and issues. */
			esc_html( sprintf( _n( '%s open', '%s open', $open, 'noteflow' ), number_format_i18n( $open ) ) )
		);
	}

	/**
	 * Styles for the column.
	 *
	 * @param string $hook Current admin page.
	 */
	public static function column_styles( $hook ) {
		if ( 'edit.php' !== $hook ) {
			return;
		}
		wp_register_style( 'noteflow-columns', false, array(), NOTEFLOW_VERSION );
		wp_enqueue_style( 'noteflow-columns' );
		wp_add_inline_style( 'noteflow-columns', '.column-noteflow{width:8em}.nf-col-open{display:inline-block;padding:1px 8px;border-radius:10px;background:#fff3c4;color:#6b4d00;font-weight:600;text-decoration:none}.nf-col-open:hover,.nf-col-open:focus{background:#ffe58a;color:#3a2a00}' );
	}
}
