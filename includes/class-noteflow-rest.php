<?php
/**
 * The REST API used by the notes app, the dashboard widget and quick capture.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Routes under /wp-json/noteflow/v1.
 *
 * Every route needs a signed-in user who can use NoteFlow. Routes for one note then
 * check that user's role on that note: viewers can read and comment, editors can
 * also change the content, and only the owner can share, trash or delete it.
 */
class NoteFlow_REST {

	const NS = 'noteflow/v1';

	/**
	 * Presence entries older than this many seconds are dropped.
	 */
	const PRESENCE_TTL = 30;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Registers one route.
	 *
	 * @param string $route    Route pattern.
	 * @param string $methods  HTTP methods.
	 * @param string $callback Method of this class.
	 */
	private static function route( $route, $methods, $callback ) {
		register_rest_route(
			self::NS,
			$route,
			array(
				'methods'             => $methods,
				'callback'            => array( __CLASS__, $callback ),
				'permission_callback' => array( __CLASS__, 'permission' ),
			)
		);
	}

	/**
	 * Registers the routes.
	 */
	public static function register_routes() {
		$note = '/notes/(?P<id>\d+)';

		self::route( '/notes', 'GET', 'list_notes' );
		self::route( '/notes', 'POST', 'create_note' );
		self::route( $note, 'GET', 'get_note' );
		self::route( $note, 'POST, PUT, PATCH', 'update_note' );
		self::route( $note, 'DELETE', 'delete_note' );
		self::route( $note . '/restore', 'POST', 'restore_note' );
		self::route( $note . '/pin', 'POST', 'pin_note' );
		self::route( $note . '/folder', 'POST', 'file_note' );
		self::route( $note . '/duplicate', 'POST', 'duplicate_note' );
		self::route( $note . '/share', 'GET', 'get_share' );
		self::route( $note . '/share', 'POST', 'update_share' );
		self::route( $note . '/leave', 'POST', 'leave_note' );
		self::route( $note . '/revisions', 'GET', 'list_revisions' );
		self::route( $note . '/revisions/(?P<rid>\d+)', 'GET', 'get_revision' );
		self::route( $note . '/revisions/(?P<rid>\d+)/restore', 'POST', 'restore_revision' );
		self::route( $note . '/comments', 'GET', 'list_comments' );
		self::route( $note . '/comments', 'POST', 'add_comment' );
		self::route( $note . '/comments/(?P<cid>\d+)', 'DELETE', 'delete_comment' );
		self::route( $note . '/reminder', 'POST', 'set_reminder' );
		self::route( $note . '/link', 'POST', 'link_note' );
		self::route( '/folders', 'POST', 'create_folder' );
		self::route( '/folders/order', 'POST', 'order_folders' );
		self::route( '/folders/(?P<folder>f[a-z0-9]+)', 'POST', 'rename_folder' );
		self::route( '/folders/(?P<folder>f[a-z0-9]+)', 'DELETE', 'delete_folder' );
		self::route( '/trash', 'DELETE', 'empty_trash' );
		self::route( '/sync', 'POST', 'sync' );
		self::route( '/people', 'GET', 'people' );
		self::route( '/content', 'GET', 'search_content' );
		self::route( '/links', 'GET', 'search_links' );
		self::route( '/prefs', 'POST', 'update_prefs' );
		self::route( '/notifications', 'GET', 'notifications' );
		self::route( '/notifications/read', 'POST', 'read_notifications' );
		self::route( '/dismiss', 'POST', 'dismiss' );
		self::route( '/export', 'GET', 'export' );
		self::route( '/import', 'POST', 'import' );
	}

	/**
	 * Every route: a signed-in user who can use NoteFlow.
	 *
	 * @return true|WP_Error
	 */
	public static function permission() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'noteflow_signed_out', __( 'You are signed out. Sign in again to keep working.', 'noteflow' ), array( 'status' => 401 ) );
		}
		if ( ! NoteFlow_Access::can_use() ) {
			return new WP_Error( 'noteflow_forbidden', __( 'You do not have access to NoteFlow.', 'noteflow' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Loads a note the current user can reach with at least the given role.
	 *
	 * @param int    $id   Note ID.
	 * @param string $need 'view', 'edit' or 'owner'.
	 * @return WP_Post|WP_Error
	 */
	private static function note( $id, $need = 'view' ) {
		$post = get_post( (int) $id );
		$role = $post ? NoteFlow_Access::role( $post ) : '';

		if ( '' === $role ) {
			return new WP_Error( 'noteflow_not_found', __( 'This note does not exist, or it is no longer shared with you.', 'noteflow' ), array( 'status' => 404 ) );
		}
		if ( 'edit' === $need && ! NoteFlow_Access::role_can_edit( $role ) ) {
			return new WP_Error( 'noteflow_read_only', __( 'You can view this note, but not change it.', 'noteflow' ), array( 'status' => 403 ) );
		}
		if ( 'owner' === $need && 'owner' !== $role ) {
			return new WP_Error( 'noteflow_not_owner', __( 'Only the owner of this note can do that.', 'noteflow' ), array( 'status' => 403 ) );
		}
		if ( 'view' !== $need && 'trash' === $post->post_status && 'owner' !== $need ) {
			return new WP_Error( 'noteflow_trashed', __( 'This note is in Recently Deleted. Recover it to make changes.', 'noteflow' ), array( 'status' => 409 ) );
		}
		return $post;
	}

	/**
	 * A module is off.
	 *
	 * @return WP_Error
	 */
	private static function module_off() {
		return new WP_Error( 'noteflow_module_off', __( 'This feature is switched off in NoteFlow settings.', 'noteflow' ), array( 'status' => 403 ) );
	}

	/**
	 * Summaries for a list of notes.
	 *
	 * @param WP_Post[] $posts   Notes.
	 * @param int       $user_id Viewer.
	 * @return array[]
	 */
	private static function summaries( $posts, $user_id ) {
		$summaries = array();
		foreach ( $posts as $post ) {
			$summaries[] = NoteFlow_Notes::summary( $post, $user_id );
		}
		return $summaries;
	}

	/**
	 * A full note with the people it mentions.
	 *
	 * @param WP_Post $post    Note.
	 * @param int     $user_id Viewer.
	 * @param int     $status  HTTP status.
	 * @return WP_REST_Response
	 */
	private static function note_response( $post, $user_id, $status = 200 ) {
		$note = NoteFlow_Notes::full( $post, $user_id );
		return new WP_REST_Response(
			array(
				'note'   => $note,
				'people' => NoteFlow_Notes::people( NoteFlow_Notes::people_in( array( $note ) ) ),
			),
			$status
		);
	}

	/**
	 * A summary, after a change that doesn't touch the content.
	 *
	 * @param int $note_id Note ID.
	 * @return array
	 */
	private static function summary_response( $note_id ) {
		clean_post_cache( $note_id );
		return array( 'note' => NoteFlow_Notes::summary( get_post( $note_id ), get_current_user_id() ) );
	}

	/**
	 * Everything the app needs to start, so the first screen needs no requests.
	 *
	 * @param int $user_id User ID.
	 * @return array
	 */
	public static function bootstrap( $user_id ) {
		NoteFlow_Notes::maybe_create_welcome( $user_id );
		NoteFlow_Notes::delete_abandoned( $user_id );

		$ids   = NoteFlow_Notes::accessible_ids( $user_id );
		$limit = (int) apply_filters( 'noteflow_initial_notes_limit', 2000 );
		$notes = self::summaries( NoteFlow_Notes::get_many( array_slice( $ids, 0, $limit ) ), $user_id );

		NoteFlow_User_State::prune( $user_id, $ids );

		$notifications = NoteFlow_Notifications::for_app( $user_id );

		return array(
			'notes'         => $notes,
			'people'        => NoteFlow_Notes::people( array_merge( array( $user_id ), NoteFlow_Notes::people_in( $notes ) ) ) + $notifications['people'],
			'folders'       => NoteFlow_User_State::folders( $user_id ),
			'filed'         => (object) NoteFlow_User_State::filed( $user_id ),
			'pins'          => NoteFlow_User_State::pins( $user_id ),
			'prefs'         => NoteFlow_User_State::prefs( $user_id ),
			'notifications' => array(
				'items'  => $notifications['items'],
				'unread' => $notifications['unread'],
			),
			'now'           => time(),
		);
	}

	/**
	 * GET /notes — every note the user can open, or search results with ?search=.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function list_notes( WP_REST_Request $request ) {
		$uid    = get_current_user_id();
		$search = trim( (string) $request->get_param( 'search' ) );

		if ( '' !== $search ) {
			return array( 'results' => NoteFlow_Notes::search( $uid, $search ) );
		}

		$ids     = NoteFlow_Notes::accessible_ids( $uid );
		$include = $request->get_param( 'include' );
		if ( $include ) {
			$ids = array_values( array_intersect( $ids, wp_parse_id_list( $include ) ) );
		}

		$notes = self::summaries( NoteFlow_Notes::get_many( $ids ), $uid );
		return array(
			'notes'  => $notes,
			'people' => NoteFlow_Notes::people( NoteFlow_Notes::people_in( $notes ) ),
		);
	}

	/**
	 * Whether the current user may attach notes to this post.
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 */
	private static function can_link( $post_id ) {
		$post = get_post( $post_id );
		return $post
			&& NoteFlow_Settings::module_enabled( 'content_notes' )
			&& in_array( $post->post_type, (array) NoteFlow_Settings::get( 'content_post_types' ), true )
			&& current_user_can( 'edit_post', $post->ID );
	}

	/**
	 * POST /notes — creates a note.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function create_note( WP_REST_Request $request ) {
		$uid     = get_current_user_id();
		$content = (string) $request->get_param( 'content' );

		if ( strlen( $content ) > NoteFlow_Notes::MAX_CONTENT ) {
			return new WP_Error( 'noteflow_too_large', __( 'This note is too long to save.', 'noteflow' ), array( 'status' => 413 ) );
		}

		$linked = (int) $request->get_param( 'linked' );
		$post   = NoteFlow_Notes::create(
			$uid,
			array(
				'title'   => (string) $request->get_param( 'title' ),
				'content' => $content,
				'color'   => (string) $request->get_param( 'color' ),
				'folder'  => (string) $request->get_param( 'folder' ),
				'linked'  => ( $linked && self::can_link( $linked ) ) ? $linked : 0,
			)
		);
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		return self::note_response( $post, $uid, 201 );
	}

	/**
	 * GET /notes/{id}
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function get_note( WP_REST_Request $request ) {
		$post = self::note( $request['id'] );
		return is_wp_error( $post ) ? $post : self::note_response( $post, get_current_user_id() );
	}

	/**
	 * POST /notes/{id} — saves title, content and/or colour.
	 *
	 * Content changes need base_version, the version the edits started from.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function update_note( WP_REST_Request $request ) {
		$post = self::note( $request['id'], 'edit' );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$uid    = get_current_user_id();
		$fields = array();

		if ( $request->has_param( 'title' ) ) {
			$fields['title'] = NoteFlow_Notes::sanitize_title( $request->get_param( 'title' ) );
		}
		if ( $request->has_param( 'content' ) ) {
			$content = (string) $request->get_param( 'content' );
			if ( strlen( $content ) > NoteFlow_Notes::MAX_CONTENT ) {
				return new WP_Error( 'noteflow_too_large', __( 'This note is too long to save.', 'noteflow' ), array( 'status' => 413 ) );
			}
			$fields['content'] = NoteFlow_Notes::sanitize_content( $content );
		}

		if ( $fields ) {
			$post = NoteFlow_Notes::update_content( $post, $uid, $fields, (int) $request->get_param( 'base_version' ), (bool) $request->get_param( 'force' ) );
			if ( is_wp_error( $post ) ) {
				return $post;
			}
		}

		if ( $request->has_param( 'color' ) ) {
			$color = NoteFlow_Notes::sanitize_color( $request->get_param( 'color' ) );
			if ( $color ) {
				update_post_meta( $post->ID, NoteFlow_Notes::COLOR, $color );
			} else {
				delete_post_meta( $post->ID, NoteFlow_Notes::COLOR );
			}
			NoteFlow_Notes::touch( $post->ID );
		}

		return self::summary_response( $post->ID );
	}

	/**
	 * DELETE /notes/{id} — moves a note to Recently Deleted, or deletes it for good
	 * when it is already there.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function delete_note( WP_REST_Request $request ) {
		$post = self::note( $request['id'], 'owner' );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		NoteFlow_Notes::flush_access_cache();

		if ( 'trash' === $post->post_status || $request->get_param( 'force' ) ) {
			wp_delete_post( $post->ID, true );
			return array(
				'deleted' => true,
				'id'      => $post->ID,
			);
		}

		wp_clear_scheduled_hook( NoteFlow_Module_Reminders::HOOK, array( $post->ID ) );
		wp_trash_post( $post->ID );

		// With EMPTY_TRASH_DAYS set to 0, WordPress deletes instead of trashing.
		if ( ! get_post( $post->ID ) ) {
			return array(
				'deleted' => true,
				'id'      => $post->ID,
			);
		}
		return self::summary_response( $post->ID );
	}

	/**
	 * POST /notes/{id}/restore — brings a note back from Recently Deleted.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function restore_note( WP_REST_Request $request ) {
		$post = self::note( $request['id'], 'owner' );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		wp_untrash_post( $post->ID );
		NoteFlow_Notes::flush_access_cache();

		if ( NoteFlow_Settings::module_enabled( 'reminders' ) ) {
			NoteFlow_Module_Reminders::schedule( $post->ID );
		}
		return self::summary_response( $post->ID );
	}

	/**
	 * POST /notes/{id}/pin — pins or unpins a note for the current user.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function pin_note( WP_REST_Request $request ) {
		$post = self::note( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		NoteFlow_User_State::set_pin( get_current_user_id(), $post->ID, (bool) $request->get_param( 'pinned' ) );
		return array( 'pins' => NoteFlow_User_State::pins( get_current_user_id() ) );
	}

	/**
	 * POST /notes/{id}/folder — files a note in one of the user's folders.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function file_note( WP_REST_Request $request ) {
		$post = self::note( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$result = NoteFlow_User_State::file_note( get_current_user_id(), $post->ID, (string) $request->get_param( 'folder' ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return array( 'filed' => (object) NoteFlow_User_State::filed( get_current_user_id() ) );
	}

	/**
	 * POST /notes/{id}/duplicate — copies a note; the copy belongs to the current user.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function duplicate_note( WP_REST_Request $request ) {
		$post = self::note( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$copy = NoteFlow_Notes::duplicate( $post, get_current_user_id() );
		return is_wp_error( $copy ) ? $copy : self::note_response( $copy, get_current_user_id(), 201 );
	}

	/**
	 * Sharing as the app shows it.
	 *
	 * @param WP_Post $post Note.
	 * @return array
	 */
	private static function share_payload( $post ) {
		$share = NoteFlow_Access::get_share( $post->ID );
		$users = array();
		foreach ( $share['users'] as $uid => $role ) {
			$users[] = array(
				'id'   => $uid,
				'role' => $role,
			);
		}
		return array(
			'owner'    => (int) $post->post_author,
			'everyone' => $share['everyone'],
			'users'    => $users,
			'people'   => NoteFlow_Notes::people( array_merge( array( (int) $post->post_author ), array_keys( $share['users'] ) ) ),
		);
	}

	/**
	 * GET /notes/{id}/share
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function get_share( WP_REST_Request $request ) {
		$post = self::note( $request['id'] );
		return is_wp_error( $post ) ? $post : self::share_payload( $post );
	}

	/**
	 * POST /notes/{id}/share — replaces who the note is shared with. Owner only.
	 *
	 * @param WP_REST_Request $request Request with 'everyone' and 'users' ([{id, role}]).
	 * @return array|WP_Error
	 */
	public static function update_share( WP_REST_Request $request ) {
		$post = self::note( $request['id'], 'owner' );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		if ( 'trash' === $post->post_status ) {
			return new WP_Error( 'noteflow_trashed', __( 'This note is in Recently Deleted. Recover it to make changes.', 'noteflow' ), array( 'status' => 409 ) );
		}
		if ( ! NoteFlow_Access::sharing_enabled() ) {
			return self::module_off();
		}

		$before   = NoteFlow_Access::get_share( $post->ID );
		$everyone = (string) $request->get_param( 'everyone' );
		if ( ! NoteFlow_Access::everyone_enabled() ) {
			$everyone = $before['everyone'];
		} elseif ( ! in_array( $everyone, array( '', 'view', 'edit' ), true ) ) {
			$everyone = '';
		}

		$users = array();
		foreach ( (array) $request->get_param( 'users' ) as $row ) {
			$uid = isset( $row['id'] ) ? (int) $row['id'] : 0;
			if ( ! $uid || (int) $post->post_author === $uid || ! NoteFlow_Access::can_use( $uid ) ) {
				continue;
			}
			$users[ $uid ] = ( isset( $row['role'] ) && 'edit' === $row['role'] ) ? 'edit' : 'view';
			if ( count( $users ) >= 100 ) {
				break;
			}
		}

		NoteFlow_Access::set_share( $post->ID, $everyone, $users );
		NoteFlow_Notes::flush_access_cache();

		foreach ( $users as $uid => $role ) {
			if ( ! isset( $before['users'][ $uid ] ) ) {
				NoteFlow_Notifications::add( $uid, 'share', $post->ID, get_current_user_id(), $role );
			}
		}

		return self::share_payload( $post ) + self::summary_response( $post->ID );
	}

	/**
	 * POST /notes/{id}/leave — removes the current user from a note shared with them.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function leave_note( WP_REST_Request $request ) {
		$post = self::note( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$uid = get_current_user_id();
		if ( (int) $post->post_author === $uid ) {
			return new WP_Error( 'noteflow_owner_leave', __( 'You own this note. Delete it instead.', 'noteflow' ), array( 'status' => 400 ) );
		}

		delete_post_meta( $post->ID, NoteFlow_Access::SHARE_VIEW, $uid );
		delete_post_meta( $post->ID, NoteFlow_Access::SHARE_EDIT, $uid );
		NoteFlow_User_State::set_pin( $uid, $post->ID, false );
		NoteFlow_User_State::file_note( $uid, $post->ID, '' );
		NoteFlow_Notes::flush_access_cache();

		return array( 'role' => NoteFlow_Access::role( $post->ID, $uid ) );
	}

	/**
	 * GET /notes/{id}/revisions — the note's history, newest first.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function list_revisions( WP_REST_Request $request ) {
		$post = self::note( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$items   = array();
		$authors = array();
		foreach ( wp_get_post_revisions( $post->ID, array( 'posts_per_page' => 60 ) ) as $revision ) {
			$items[]   = array(
				'id'      => $revision->ID,
				'author'  => (int) $revision->post_author,
				'time'    => (int) strtotime( $revision->post_date_gmt . ' +0000' ),
				'title'   => html_entity_decode( $revision->post_title, ENT_QUOTES, 'UTF-8' ),
				'current' => $revision->post_content === $post->post_content && $revision->post_title === $post->post_title,
			);
			$authors[] = (int) $revision->post_author;
		}

		return array(
			'revisions' => $items,
			'people'    => NoteFlow_Notes::people( $authors ),
		);
	}

	/**
	 * Loads a revision of this note.
	 *
	 * @param WP_Post $post Note.
	 * @param int     $rid  Revision ID.
	 * @return WP_Post|WP_Error
	 */
	private static function revision( $post, $rid ) {
		$rid      = (int) $rid; // wp_get_post_revision() takes its argument by reference.
		$revision = wp_get_post_revision( $rid );
		if ( ! $revision || (int) $revision->post_parent !== $post->ID ) {
			return new WP_Error( 'noteflow_revision_missing', __( 'That version no longer exists.', 'noteflow' ), array( 'status' => 404 ) );
		}
		return $revision;
	}

	/**
	 * GET /notes/{id}/revisions/{rid}
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function get_revision( WP_REST_Request $request ) {
		$post = self::note( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$revision = self::revision( $post, $request['rid'] );
		if ( is_wp_error( $revision ) ) {
			return $revision;
		}

		return array(
			'id'      => $revision->ID,
			'author'  => (int) $revision->post_author,
			'time'    => (int) strtotime( $revision->post_date_gmt . ' +0000' ),
			'title'   => html_entity_decode( $revision->post_title, ENT_QUOTES, 'UTF-8' ),
			'content' => NoteFlow_Notes::prepare_content( $revision->post_content ),
		);
	}

	/**
	 * POST /notes/{id}/revisions/{rid}/restore — makes an old version the current one.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function restore_revision( WP_REST_Request $request ) {
		$post = self::note( $request['id'], 'edit' );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$revision = self::revision( $post, $request['rid'] );
		if ( is_wp_error( $revision ) ) {
			return $revision;
		}

		$uid  = get_current_user_id();
		$post = NoteFlow_Notes::update_content(
			$post,
			$uid,
			array(
				'title'   => NoteFlow_Notes::sanitize_title( html_entity_decode( $revision->post_title, ENT_QUOTES, 'UTF-8' ) ),
				'content' => NoteFlow_Notes::sanitize_content( $revision->post_content ),
			),
			0,
			true
		);
		return is_wp_error( $post ) ? $post : self::note_response( $post, $uid );
	}

	/**
	 * Comments need the Comments setting.
	 *
	 * @return true|WP_Error
	 */
	private static function comments_on() {
		return NoteFlow_Settings::get( 'comments' ) ? true : self::module_off();
	}

	/**
	 * GET /notes/{id}/comments
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function list_comments( WP_REST_Request $request ) {
		$on   = self::comments_on();
		$post = is_wp_error( $on ) ? $on : self::note( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$comments = NoteFlow_Comments::get( $post->ID );
		return array(
			'comments' => $comments,
			'people'   => NoteFlow_Notes::people( wp_list_pluck( $comments, 'author' ) ),
		);
	}

	/**
	 * POST /notes/{id}/comments — anyone who can open the note can comment.
	 *
	 * @param WP_REST_Request $request Request with 'text' and 'mentions'.
	 * @return array|WP_Error
	 */
	public static function add_comment( WP_REST_Request $request ) {
		$on   = self::comments_on();
		$post = is_wp_error( $on ) ? $on : self::note( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		if ( 'trash' === $post->post_status ) {
			return new WP_Error( 'noteflow_trashed', __( 'This note is in Recently Deleted. Recover it to make changes.', 'noteflow' ), array( 'status' => 409 ) );
		}

		$comment = NoteFlow_Comments::add( $post, get_current_user_id(), (string) $request->get_param( 'text' ), (array) $request->get_param( 'mentions' ) );
		if ( is_wp_error( $comment ) ) {
			return $comment;
		}
		return array(
			'comment' => $comment,
			'people'  => NoteFlow_Notes::people( array( $comment['author'] ) ),
		);
	}

	/**
	 * DELETE /notes/{id}/comments/{cid}
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|WP_Error
	 */
	public static function delete_comment( WP_REST_Request $request ) {
		$on   = self::comments_on();
		$post = is_wp_error( $on ) ? $on : self::note( $request['id'] );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		$result = NoteFlow_Comments::delete( $post, (int) $request['cid'], get_current_user_id() );
		return is_wp_error( $result ) ? $result : array( 'deleted' => true );
	}

	/**
	 * POST /notes/{id}/reminder — sets or clears (at = 0) a reminder.
	 *
	 * @param WP_REST_Request $request Request with 'at', a Unix timestamp.
	 * @return array|WP_Error
	 */
	public static function set_reminder( WP_REST_Request $request ) {
		if ( ! NoteFlow_Settings::module_enabled( 'reminders' ) ) {
			return self::module_off();
		}
		$post = self::note( $request['id'], 'edit' );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$at = (int) $request->get_param( 'at' );
		if ( $at && $at < time() - 60 ) {
			return new WP_Error( 'noteflow_reminder_past', __( 'Pick a time in the future.', 'noteflow' ), array( 'status' => 400 ) );
		}

		NoteFlow_Module_Reminders::set( $post->ID, $at, get_current_user_id() );
		NoteFlow_Notes::touch( $post->ID );
		return self::summary_response( $post->ID );
	}

	/**
	 * POST /notes/{id}/link — attaches a note to a post, or detaches it with post = 0.
	 *
	 * @param WP_REST_Request $request Request with 'post'.
	 * @return array|WP_Error
	 */
	public static function link_note( WP_REST_Request $request ) {
		if ( ! NoteFlow_Settings::module_enabled( 'content_notes' ) ) {
			return self::module_off();
		}
		$post = self::note( $request['id'], 'edit' );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$target = (int) $request->get_param( 'post' );
		if ( $target ) {
			if ( ! self::can_link( $target ) ) {
				return new WP_Error( 'noteflow_link_forbidden', __( 'You can only attach notes to content you can edit.', 'noteflow' ), array( 'status' => 403 ) );
			}
			update_post_meta( $post->ID, NoteFlow_Notes::LINKED, $target );
		} else {
			delete_post_meta( $post->ID, NoteFlow_Notes::LINKED );
		}

		NoteFlow_Notes::touch( $post->ID );
		return self::summary_response( $post->ID );
	}

	/**
	 * POST /folders — creates a folder.
	 *
	 * @param WP_REST_Request $request Request with 'name'.
	 * @return array|WP_Error
	 */
	public static function create_folder( WP_REST_Request $request ) {
		$folder = NoteFlow_User_State::add_folder( get_current_user_id(), (string) $request->get_param( 'name' ) );
		if ( is_wp_error( $folder ) ) {
			return $folder;
		}
		return array(
			'folder'  => $folder,
			'folders' => NoteFlow_User_State::folders( get_current_user_id() ),
		);
	}

	/**
	 * POST /folders/{folder} — renames a folder.
	 *
	 * @param WP_REST_Request $request Request with 'name'.
	 * @return array|WP_Error
	 */
	public static function rename_folder( WP_REST_Request $request ) {
		$result = NoteFlow_User_State::rename_folder( get_current_user_id(), (string) $request['folder'], (string) $request->get_param( 'name' ) );
		return is_wp_error( $result ) ? $result : array( 'folders' => NoteFlow_User_State::folders( get_current_user_id() ) );
	}

	/**
	 * DELETE /folders/{folder} — deletes a folder; its notes move to Notes.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function delete_folder( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		NoteFlow_User_State::delete_folder( $uid, (string) $request['folder'] );
		return array(
			'folders' => NoteFlow_User_State::folders( $uid ),
			'filed'   => (object) NoteFlow_User_State::filed( $uid ),
		);
	}

	/**
	 * POST /folders/order
	 *
	 * @param WP_REST_Request $request Request with 'order', a list of folder IDs.
	 * @return array
	 */
	public static function order_folders( WP_REST_Request $request ) {
		NoteFlow_User_State::reorder_folders( get_current_user_id(), array_map( 'strval', (array) $request->get_param( 'order' ) ) );
		return array( 'folders' => NoteFlow_User_State::folders( get_current_user_id() ) );
	}

	/**
	 * DELETE /trash — deletes every note in the user's Recently Deleted.
	 *
	 * @return array
	 */
	public static function empty_trash() {
		$ids = get_posts(
			array(
				'post_type'      => NoteFlow_Notes::POST_TYPE,
				'post_status'    => 'trash',
				'author'         => get_current_user_id(),
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);
		foreach ( $ids as $id ) {
			wp_delete_post( $id, true );
		}
		NoteFlow_Notes::flush_access_cache();
		return array( 'deleted' => array_map( 'intval', $ids ) );
	}

	/**
	 * Records that a user has a note open, and returns everyone else who does.
	 *
	 * @param int  $note_id Note ID.
	 * @param int  $user_id User ID.
	 * @param bool $editing Whether they are typing.
	 * @return array[] Other people: id and editing.
	 */
	private static function presence_ping( $note_id, $user_id, $editing ) {
		$key = 'noteflow_presence_' . $note_id;
		$now = time();
		$map = get_transient( $key );
		$map = is_array( $map ) ? $map : array();

		$map[ $user_id ] = array(
			't' => $now,
			'e' => $editing ? 1 : 0,
		);

		$others = array();
		foreach ( $map as $uid => $row ) {
			if ( ! isset( $row['t'] ) || $row['t'] < $now - self::PRESENCE_TTL ) {
				unset( $map[ $uid ] );
			} elseif ( (int) $uid !== $user_id ) {
				$others[] = array(
					'id'      => (int) $uid,
					'editing' => ! empty( $row['e'] ),
				);
			}
		}

		set_transient( $key, $map, 2 * MINUTE_IN_SECONDS );
		return $others;
	}

	/**
	 * Removes a user from a note's presence list.
	 *
	 * @param int $note_id Note ID.
	 * @param int $user_id User ID.
	 */
	private static function presence_leave( $note_id, $user_id ) {
		$key = 'noteflow_presence_' . $note_id;
		$map = get_transient( $key );
		if ( is_array( $map ) && isset( $map[ $user_id ] ) ) {
			unset( $map[ $user_id ] );
			set_transient( $key, $map, 2 * MINUTE_IN_SECONDS );
		}
	}

	/**
	 * POST /sync — the app's heartbeat.
	 *
	 * Returns the IDs the user can open (to spot new and removed notes), summaries of
	 * notes changed since the last sync, the unread count, and for the open note its
	 * latest version and who else has it open.
	 *
	 * @param WP_REST_Request $request Request with 'since', 'note', 'editing' and 'left'.
	 * @return array
	 */
	public static function sync( WP_REST_Request $request ) {
		$uid   = get_current_user_id();
		$since = (int) $request->get_param( 'since' );
		$ids   = NoteFlow_Notes::accessible_ids( $uid );

		$response = array(
			'now'     => time(),
			'ids'     => $ids,
			'changed' => array(),
			'unread'  => NoteFlow_Notifications::unread_count( $uid ),
			'note'    => null,
		);
		$people   = array();

		if ( $since > 0 && $ids ) {
			$changed = get_posts(
				array(
					'post_type'              => NoteFlow_Notes::POST_TYPE,
					'post_status'            => array( 'publish', 'trash' ),
					'post__in'               => $ids,
					'posts_per_page'         => 200, // phpcs:ignore WordPress.WP.PostsPerPage.posts_per_page_posts_per_page -- Notes changed since the last sync.
					'no_found_rows'          => true,
					'update_post_term_cache' => false,
					'date_query'             => array(
						array(
							'column'    => 'post_modified_gmt',
							'after'     => gmdate( 'Y-m-d H:i:s', $since - 5 ),
							'inclusive' => true,
						),
					),
				)
			);

			$response['changed'] = self::summaries( $changed, $uid );
			$people              = NoteFlow_Notes::people_in( $response['changed'] );
		}

		$left = (int) $request->get_param( 'left' );
		if ( $left ) {
			self::presence_leave( $left, $uid );
		}

		$note_id = (int) $request->get_param( 'note' );
		if ( $note_id ) {
			if ( in_array( $note_id, $ids, true ) ) {
				$post     = get_post( $note_id );
				$presence = self::presence_ping( $note_id, $uid, (bool) $request->get_param( 'editing' ) );
				$editor   = (int) get_post_meta( $note_id, NoteFlow_Notes::MODIFIED_BY, true );

				$response['note'] = array(
					'id'         => $note_id,
					'version'    => NoteFlow_Notes::version( $note_id ),
					'modified'   => (int) strtotime( $post->post_modified_gmt . ' +0000' ),
					'modifiedBy' => $editor ? $editor : (int) $post->post_author,
					'role'       => NoteFlow_Access::role( $post, $uid ),
					'status'     => 'trash' === $post->post_status ? 'trash' : 'active',
					'presence'   => $presence,
					'comments'   => NoteFlow_Settings::get( 'comments' ) ? count( (array) get_post_meta( $note_id, NoteFlow_Comments::META, false ) ) : 0,
				);

				$people[] = $response['note']['modifiedBy'];
				foreach ( $presence as $person ) {
					$people[] = $person['id'];
				}
			} else {
				$response['note'] = array(
					'id'      => $note_id,
					'removed' => true,
				);
			}
		}

		$response['people'] = NoteFlow_Notes::people( $people );
		return $response;
	}

	/**
	 * GET /people — people a note can be shared with, for the share dialog.
	 *
	 * Returns names and avatars only, never email addresses.
	 *
	 * @param WP_REST_Request $request Request with 'search'.
	 * @return array
	 */
	public static function people( WP_REST_Request $request ) {
		$search = trim( sanitize_text_field( (string) $request->get_param( 'search' ) ) );
		$args   = array(
			'role__in' => NoteFlow_Access::allowed_roles(),
			'number'   => 21,
			'orderby'  => 'display_name',
			'fields'   => 'ID',
		);
		if ( '' !== $search ) {
			$args['search']         = '*' . $search . '*';
			$args['search_columns'] = array( 'display_name', 'user_login', 'user_nicename' );
		}

		$me  = get_current_user_id();
		$ids = array_filter(
			array_map( 'intval', get_users( $args ) ),
			function ( $id ) use ( $me ) {
				return $id !== $me && NoteFlow_Access::can_use( $id );
			}
		);
		return array( 'people' => array_values( NoteFlow_Notes::people( array_slice( $ids, 0, 20 ) ) ) );
	}

	/**
	 * GET /content — posts the user can attach notes to.
	 *
	 * @param WP_REST_Request $request Request with 'search'.
	 * @return array|WP_Error
	 */
	public static function search_content( WP_REST_Request $request ) {
		if ( ! NoteFlow_Settings::module_enabled( 'content_notes' ) ) {
			return self::module_off();
		}

		$types  = (array) NoteFlow_Settings::get( 'content_post_types' );
		$search = trim( sanitize_text_field( (string) $request->get_param( 'search' ) ) );
		if ( ! $types ) {
			return array( 'items' => array() );
		}

		$args = array(
			'post_type'      => $types,
			'post_status'    => array( 'publish', 'draft', 'pending', 'future', 'private' ),
			'posts_per_page' => 20,
			'no_found_rows'  => true,
			'orderby'        => 'modified',
		);
		if ( '' !== $search ) {
			$args['s']       = $search;
			$args['orderby'] = 'relevance';
		}

		$items = array();
		foreach ( get_posts( $args ) as $post ) {
			if ( ! current_user_can( 'edit_post', $post->ID ) ) {
				continue;
			}
			$type    = get_post_type_object( $post->post_type );
			$title   = trim( html_entity_decode( $post->post_title, ENT_QUOTES, 'UTF-8' ) );
			$items[] = array(
				'id'     => $post->ID,
				'title'  => '' === $title ? __( '(no title)', 'noteflow' ) : $title,
				'type'   => $type ? $type->labels->singular_name : $post->post_type,
				'status' => $post->post_status,
			);
		}
		return array( 'items' => $items );
	}

	/**
	 * GET /links — posts, pages, any post type with an editing screen, and notes, to link
	 * to from a note. Published content links to its page; drafts and private items link
	 * to their editing screen, for people who can edit them.
	 *
	 * @param WP_REST_Request $request Request with 'search'.
	 * @return array
	 */
	public static function search_links( WP_REST_Request $request ) {
		$search = trim( sanitize_text_field( (string) $request->get_param( 'search' ) ) );
		$uid    = get_current_user_id();
		$items  = array();

		// Notes first: linking one note to another is the most common case.
		$note_ids = NoteFlow_Notes::accessible_ids( $uid, false );
		if ( $note_ids ) {
			$notes = get_posts(
				array(
					'post_type'              => NoteFlow_Notes::POST_TYPE,
					'post_status'            => 'publish',
					'post__in'               => $note_ids,
					's'                      => $search,
					'posts_per_page'         => 4,
					'no_found_rows'          => true,
					'update_post_term_cache' => false,
					'orderby'                => '' === $search ? 'modified' : 'relevance',
				)
			);
			foreach ( $notes as $note ) {
				$summary = NoteFlow_Notes::summary( $note, $uid );
				$items[] = array(
					'id'     => $note->ID,
					'title'  => '' === $summary['title'] ? __( 'New Note', 'noteflow' ) : $summary['title'],
					'type'   => __( 'Note', 'noteflow' ),
					'kind'   => 'note',
					'status' => '',
					'url'    => NoteFlow_Admin::note_url( $note->ID ),
				);
			}
		}

		$types = array();
		foreach ( get_post_types( array( 'show_ui' => true ), 'objects' ) as $type ) {
			if ( ! in_array( $type->name, array( 'attachment', 'wp_block', 'wp_navigation', 'wp_template', 'wp_template_part', 'wp_font_family', 'wp_font_face', 'wp_global_styles', NoteFlow_Notes::POST_TYPE ), true ) ) {
				$types[ $type->name ] = $type;
			}
		}

		$posts = $types ? get_posts(
			array(
				'post_type'              => array_keys( $types ),
				'post_status'            => array( 'publish', 'draft', 'pending', 'future', 'private' ),
				's'                      => $search,
				'posts_per_page'         => 20,
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
				'orderby'                => '' === $search ? 'modified' : 'relevance',
			)
		) : array();

		foreach ( $posts as $post ) {
			$type = $types[ $post->post_type ];
			$url  = '';
			if ( 'publish' === $post->post_status && is_post_type_viewable( $type ) ) {
				$url = get_permalink( $post );
			} elseif ( ( 'private' === $post->post_status && current_user_can( 'read_post', $post->ID ) && is_post_type_viewable( $type ) ) ) {
				$url = get_permalink( $post );
			} elseif ( current_user_can( 'edit_post', $post->ID ) ) {
				$url = get_edit_post_link( $post->ID, 'raw' );
			}
			if ( ! $url ) {
				continue;
			}
			$title   = trim( html_entity_decode( $post->post_title, ENT_QUOTES, 'UTF-8' ) );
			$items[] = array(
				'id'     => $post->ID,
				'title'  => '' === $title ? __( '(no title)', 'noteflow' ) : $title,
				'type'   => $type->labels->singular_name,
				'kind'   => 'post',
				'status' => 'publish' === $post->post_status ? '' : $post->post_status,
				'url'    => (string) $url,
			);
			if ( count( $items ) >= 12 ) {
				break;
			}
		}

		return array( 'items' => $items );
	}

	/**
	 * POST /prefs — saves the user's preferences.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array
	 */
	public static function update_prefs( WP_REST_Request $request ) {
		$changes = $request->get_json_params();
		return array( 'prefs' => NoteFlow_User_State::update_prefs( get_current_user_id(), is_array( $changes ) ? $changes : array() ) );
	}

	/**
	 * GET /notifications
	 *
	 * @return array
	 */
	public static function notifications() {
		return NoteFlow_Notifications::for_app( get_current_user_id() );
	}

	/**
	 * POST /notifications/read — marks some, or all, notifications as read.
	 *
	 * @param WP_REST_Request $request Request with optional 'ids'.
	 * @return array
	 */
	public static function read_notifications( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		NoteFlow_Notifications::mark_read( $uid, array_map( 'strval', (array) $request->get_param( 'ids' ) ) );
		return array( 'unread' => NoteFlow_Notifications::unread_count( $uid ) );
	}

	/**
	 * POST /dismiss — hides the 2.0 notice or the review request for this user.
	 *
	 * @param WP_REST_Request $request Request with 'what' and, for reviews, 'later'.
	 * @return array
	 */
	public static function dismiss( WP_REST_Request $request ) {
		$what = (string) $request->get_param( 'what' );
		$uid  = get_current_user_id();

		if ( 'upgrade' === $what ) {
			update_user_option( $uid, 'noteflow_upgrade_seen', NOTEFLOW_VERSION );
		} elseif ( 'review' === $what ) {
			NoteFlow_Review::answer( $uid, $request->get_param( 'later' ) ? 'later' : 'done' );
		}
		return array( 'ok' => true );
	}

	/**
	 * GET /export — a backup of every note the user owns.
	 *
	 * @return array|WP_Error
	 */
	public static function export() {
		if ( ! NoteFlow_Settings::module_enabled( 'export' ) ) {
			return self::module_off();
		}

		$uid     = get_current_user_id();
		$folders = array();
		foreach ( NoteFlow_User_State::folders( $uid ) as $folder ) {
			$folders[ $folder['id'] ] = $folder['name'];
		}
		$filed = NoteFlow_User_State::filed( $uid );
		$pins  = NoteFlow_User_State::pins( $uid );
		$posts = get_posts(
			array(
				'post_type'      => NoteFlow_Notes::POST_TYPE,
				'post_status'    => 'publish',
				'author'         => $uid,
				'posts_per_page' => -1,
				'orderby'        => 'modified',
			)
		);

		$notes = array();
		foreach ( $posts as $post ) {
			$notes[] = array(
				'title'    => html_entity_decode( $post->post_title, ENT_QUOTES, 'UTF-8' ),
				'content'  => NoteFlow_Notes::prepare_content( $post->post_content ),
				'color'    => NoteFlow_Notes::sanitize_color( get_post_meta( $post->ID, NoteFlow_Notes::COLOR, true ) ),
				'folder'   => isset( $filed[ $post->ID ], $folders[ $filed[ $post->ID ] ] ) ? $folders[ $filed[ $post->ID ] ] : '',
				'pinned'   => in_array( $post->ID, $pins, true ),
				'created'  => gmdate( 'c', (int) strtotime( $post->post_date_gmt . ' +0000' ) ),
				'modified' => gmdate( 'c', (int) strtotime( $post->post_modified_gmt . ' +0000' ) ),
			);
		}

		return array(
			'format'   => 'noteflow',
			'version'  => 1,
			'plugin'   => NOTEFLOW_VERSION,
			'site'     => home_url(),
			'exported' => gmdate( 'c' ),
			'folders'  => array_values( $folders ),
			'notes'    => $notes,
		);
	}

	/**
	 * POST /import — creates notes from a NoteFlow backup, owned by the current user.
	 *
	 * @param WP_REST_Request $request Request with 'notes' and 'folders'.
	 * @return array|WP_Error
	 */
	public static function import( WP_REST_Request $request ) {
		if ( ! NoteFlow_Settings::module_enabled( 'export' ) ) {
			return self::module_off();
		}

		$uid   = get_current_user_id();
		$notes = (array) $request->get_param( 'notes' );
		if ( ! $notes ) {
			return new WP_Error( 'noteflow_import_empty', __( 'That file has no notes in it.', 'noteflow' ), array( 'status' => 400 ) );
		}
		if ( count( $notes ) > 1000 ) {
			return new WP_Error( 'noteflow_import_large', __( 'Import up to 1,000 notes at a time.', 'noteflow' ), array( 'status' => 400 ) );
		}

		// Reuse folders with the same name; create the rest.
		$folder_ids = array();
		foreach ( NoteFlow_User_State::folders( $uid ) as $folder ) {
			$folder_ids[ strtolower( $folder['name'] ) ] = $folder['id'];
		}
		$folder_for = function ( $name ) use ( $uid, &$folder_ids ) {
			$name = trim( sanitize_text_field( (string) $name ) );
			if ( '' === $name ) {
				return '';
			}
			if ( ! isset( $folder_ids[ strtolower( $name ) ] ) ) {
				$folder = NoteFlow_User_State::add_folder( $uid, $name );
				if ( is_wp_error( $folder ) ) {
					return '';
				}
				$folder_ids[ strtolower( $name ) ] = $folder['id'];
			}
			return $folder_ids[ strtolower( $name ) ];
		};

		$imported = 0;
		foreach ( $notes as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$content = isset( $row['content'] ) ? (string) $row['content'] : '';
			if ( strlen( $content ) > NoteFlow_Notes::MAX_CONTENT ) {
				continue;
			}
			$post = NoteFlow_Notes::create(
				$uid,
				array(
					'title'    => isset( $row['title'] ) ? (string) $row['title'] : '',
					'content'  => $content,
					'color'    => isset( $row['color'] ) ? (string) $row['color'] : '',
					'folder'   => isset( $row['folder'] ) ? $folder_for( $row['folder'] ) : '',
					'revision' => false,
				)
			);
			if ( is_wp_error( $post ) ) {
				continue;
			}
			if ( ! empty( $row['pinned'] ) ) {
				NoteFlow_User_State::set_pin( $uid, $post->ID, true );
			}
			++$imported;
		}

		return array( 'imported' => $imported ) + self::bootstrap( $uid );
	}
}
