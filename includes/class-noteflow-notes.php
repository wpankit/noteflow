<?php
/**
 * Reading and writing notes.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * The notes data layer.
 */
class NoteFlow_Notes {

	const POST_TYPE     = NoteFlow_Post_Type::NAME;
	const MODIFIED_BY   = '_noteflow_modified_by';
	const COLOR         = '_note_color';
	const REMINDER      = '_noteflow_reminder';
	const REMINDER_BY   = '_noteflow_reminder_by';
	const REMINDER_SENT = '_noteflow_reminder_sent';
	const LINKED        = '_noteflow_linked_post';

	/**
	 * A person's saves within this many seconds share one revision.
	 */
	const REVISION_GAP = 600;

	/**
	 * Largest note content accepted, in bytes.
	 */
	const MAX_CONTENT = 1048576;

	/**
	 * Accessible note IDs per user, for this request.
	 *
	 * @var array<string,int[]>
	 */
	private static $ids_cache = array();

	/**
	 * Hooks.
	 */
	public static function init() {
		add_filter( 'wp_save_post_revision_post_has_changed', array( __CLASS__, 'throttle_revisions' ), 10, 3 );
		add_filter( 'wp_revisions_to_keep', array( __CLASS__, 'revisions_to_keep' ), 10, 2 );
		add_filter( 'wp_untrash_post_status', array( __CLASS__, 'untrash_status' ), 10, 2 );
		add_action( 'before_delete_post', array( __CLASS__, 'before_delete' ), 10, 2 );
	}

	/**
	 * Keeps one revision per person per ten minutes of editing, instead of one per autosave.
	 * A save by someone else always starts a new revision, so history shows who changed what.
	 *
	 * @param bool    $changed         Whether the post changed since the latest revision.
	 * @param WP_Post $latest_revision Latest revision.
	 * @param WP_Post $post            The post being saved.
	 * @return bool
	 */
	public static function throttle_revisions( $changed, $latest_revision, $post ) {
		if ( ! $changed || self::POST_TYPE !== $post->post_type ) {
			return $changed;
		}

		$age = time() - (int) strtotime( $latest_revision->post_date_gmt . ' +0000' );

		return ! ( get_current_user_id() === (int) $latest_revision->post_author && $age < self::REVISION_GAP );
	}

	/**
	 * Keeps the last 60 revisions of each note.
	 *
	 * @param int     $num  Revisions to keep.
	 * @param WP_Post $post Post.
	 * @return int
	 */
	public static function revisions_to_keep( $num, $post ) {
		return self::POST_TYPE === $post->post_type ? (int) apply_filters( 'noteflow_revisions_to_keep', 60 ) : $num;
	}

	/**
	 * Restored notes go back to being published; core would make them drafts.
	 *
	 * @param string $status  Status core picked.
	 * @param int    $post_id Post ID.
	 * @return string
	 */
	public static function untrash_status( $status, $post_id ) {
		return self::POST_TYPE === get_post_type( $post_id ) ? 'publish' : $status;
	}

	/**
	 * Cleans up after a note is deleted for good.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post.
	 */
	public static function before_delete( $post_id, $post = null ) {
		$post = $post ? $post : get_post( $post_id );
		if ( $post && self::POST_TYPE === $post->post_type ) {
			wp_clear_scheduled_hook( NoteFlow_Module_Reminders::HOOK, array( (int) $post_id ) );
			delete_transient( 'noteflow_presence_' . (int) $post_id );
		}
	}

	/**
	 * IDs of every note a user can open, newest change first.
	 *
	 * @param int  $user_id    User ID.
	 * @param bool $with_trash Include the user's own notes in Recently Deleted.
	 * @return int[]
	 */
	public static function accessible_ids( $user_id, $with_trash = true ) {
		global $wpdb;

		$user_id = (int) $user_id;
		$key     = $user_id . ( $with_trash ? ':t' : ':a' );

		if ( isset( self::$ids_cache[ $key ] ) ) {
			return self::$ids_cache[ $key ];
		}
		if ( ! $user_id || ! NoteFlow_Access::can_use( $user_id ) ) {
			return array();
		}

		$sharing  = NoteFlow_Access::sharing_enabled() ? 1 : 0;
		$everyone = NoteFlow_Access::everyone_enabled() ? 1 : 0;

		// One static query; the switches turn shared notes and Recently Deleted on or off.
		$ids = array_map(
			'intval',
			$wpdb->get_col( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$wpdb->prepare(
					"SELECT p.ID FROM {$wpdb->posts} p
					WHERE p.post_type = %s AND (
						( p.post_status = 'publish' AND (
							p.post_author = %d
							OR ( %d = 1 AND EXISTS (
								SELECT 1 FROM {$wpdb->postmeta} m WHERE m.post_id = p.ID AND (
									( m.meta_key IN ( %s, %s ) AND m.meta_value = %s )
									OR ( %d = 1 AND m.meta_key = %s AND m.meta_value IN ( 'view', 'edit' ) )
								)
							) )
						) )
						OR ( %d = 1 AND p.post_status = 'trash' AND p.post_author = %d )
					)
					ORDER BY p.post_modified_gmt DESC, p.ID DESC",
					self::POST_TYPE,
					$user_id,
					$sharing,
					NoteFlow_Access::SHARE_VIEW,
					NoteFlow_Access::SHARE_EDIT,
					(string) $user_id,
					$everyone,
					NoteFlow_Access::EVERYONE,
					$with_trash ? 1 : 0,
					$user_id
				)
			)
		);

		/**
		 * Filters the notes a user can see in lists, search and sync.
		 *
		 * Removing IDs hides notes from the lists; it does not change who can open them.
		 *
		 * @param int[] $ids        Note IDs, newest change first.
		 * @param int   $user_id    User ID.
		 * @param bool  $with_trash Whether the user's Recently Deleted notes are included.
		 */
		$ids = array_values( array_map( 'intval', (array) apply_filters( 'noteflow_accessible_ids', $ids, $user_id, $with_trash ) ) );

		self::$ids_cache[ $key ] = $ids;
		return $ids;
	}

	/**
	 * Forgets cached access lists, after sharing or trash changes.
	 */
	public static function flush_access_cache() {
		self::$ids_cache = array();
	}

	/**
	 * Loads notes by ID with their meta, in the given order.
	 *
	 * @param int[] $ids Note IDs.
	 * @return WP_Post[]
	 */
	public static function get_many( $ids ) {
		$ids = array_values( array_filter( array_map( 'intval', (array) $ids ) ) );
		if ( ! $ids ) {
			return array();
		}
		$posts = array();
		foreach ( array_chunk( $ids, 500 ) as $chunk ) {
			$posts = array_merge(
				$posts,
				get_posts(
					array(
						'post_type'              => self::POST_TYPE,
						'post_status'            => array( 'publish', 'trash' ),
						'post__in'               => $chunk,
						'orderby'                => 'post__in',
						'posts_per_page'         => count( $chunk ),
						'no_found_rows'          => true,
						'update_post_term_cache' => false,
					)
				)
			);
		}
		return $posts;
	}

	/**
	 * A note's content version, used to spot saves that would overwrite someone else's.
	 *
	 * The version lives in the post's menu_order column, which notes don't otherwise use,
	 * so a save can change the content and the version in one UPDATE statement.
	 *
	 * @param WP_Post|int $post Note.
	 * @return int
	 */
	public static function version( $post ) {
		$post = get_post( $post );
		return $post ? max( 1, (int) $post->menu_order ) : 1;
	}

	/**
	 * Content ready for the editor. Plain-text notes from 1.x get paragraphs.
	 *
	 * @param string $content Stored content.
	 * @return string
	 */
	public static function prepare_content( $content ) {
		$content = (string) $content;
		if ( '' !== trim( $content ) && ! preg_match( '#<(p|div|h[1-6]|ul|ol|table|blockquote|pre|figure)\b#i', $content ) ) {
			$content = wpautop( $content );
		}
		return $content;
	}

	/**
	 * HTML allowed in notes: what posts allow, plus classes for checklists and highlights.
	 *
	 * @return array
	 */
	public static function allowed_html() {
		$allowed = wp_kses_allowed_html( 'post' );
		foreach ( array( 'mark', 'code', 'pre', 's', 'del', 'u', 'kbd', 'sub', 'sup', 'hr', 'figure', 'figcaption' ) as $tag ) {
			if ( ! isset( $allowed[ $tag ] ) ) {
				$allowed[ $tag ] = array();
			}
			$allowed[ $tag ]['class'] = true;
		}

		/**
		 * Filters the HTML allowed in note content.
		 *
		 * @param array $allowed Allowed tags and attributes, as for wp_kses().
		 */
		return apply_filters( 'noteflow_allowed_html', $allowed );
	}

	/**
	 * Cleans note HTML.
	 *
	 * @param string $html Raw HTML.
	 * @return string
	 */
	public static function sanitize_content( $html ) {
		$html = wp_kses( (string) $html, self::allowed_html() );

		// Empty paragraphs the editor leaves at the end.
		$html = preg_replace( '#(?:\s*<p>(?:\s|&nbsp;|<br\s*/?>)*</p>)+\s*$#i', '', $html );

		return trim( (string) $html );
	}

	/**
	 * Cleans a note title.
	 *
	 * @param string $title Raw title.
	 * @return string
	 */
	public static function sanitize_title( $title ) {
		$title = trim( sanitize_text_field( (string) $title ) );
		return function_exists( 'mb_substr' ) ? mb_substr( $title, 0, 200 ) : substr( $title, 0, 200 );
	}

	/**
	 * Cleans a note colour: a hex colour, or '' for none.
	 *
	 * @param string $color Raw colour.
	 * @return string
	 */
	public static function sanitize_color( $color ) {
		$color = sanitize_hex_color( (string) $color );
		return ( $color && '#ffffff' !== strtolower( $color ) ) ? strtolower( $color ) : '';
	}

	/**
	 * Note HTML as plain text, one line per block.
	 *
	 * @param string $html HTML.
	 * @return string
	 */
	public static function plain_text( $html ) {
		$html  = preg_replace( '#<(br|hr)\b[^>]*>#i', "\n", (string) $html );
		$html  = preg_replace( '#</(p|div|h[1-6]|li|blockquote|pre|tr|table|ul|ol|figure|figcaption)>#i', "\n", $html );
		$html  = preg_replace( '#</t[dh]>#i', ' ', $html );
		$text  = html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$text  = str_replace( "\xc2\xa0", ' ', $text );
		$lines = array();
		foreach ( explode( "\n", $text ) as $line ) {
			$line = trim( preg_replace( '/[ \t]+/u', ' ', $line ) );
			if ( '' !== $line ) {
				$lines[] = $line;
			}
		}
		return implode( "\n", $lines );
	}

	/**
	 * Hashtags in a note, like #launch or #client-a.
	 *
	 * @param string $text Plain text.
	 * @return string[]
	 */
	public static function tags( $text ) {
		if ( false === strpos( $text, '#' ) || ! preg_match_all( '/(?:^|[\s(\[{,;])#([\p{L}\p{N}_][\p{L}\p{N}_\-]{0,48})/u', $text, $matches ) ) {
			return array();
		}
		$tags = array();
		foreach ( $matches[1] as $tag ) {
			$tag = rtrim( $tag, '-_' );
			if ( '' === $tag || ctype_digit( $tag ) ) {
				continue;
			}
			$tag = function_exists( 'mb_strtolower' ) ? mb_strtolower( $tag, 'UTF-8' ) : strtolower( $tag );

			$tags[ $tag ] = true;
		}
		return array_slice( array_keys( $tags ), 0, 30 );
	}

	/**
	 * Checklist progress: [done, total].
	 *
	 * @param string $html HTML.
	 * @return int[]
	 */
	public static function checklist( $html ) {
		if ( false === strpos( $html, 'nf-checklist' ) || ! preg_match_all( '#<ul\b[^>]*\bnf-checklist\b[^>]*>(.*?)</ul>#is', $html, $lists ) ) {
			return array( 0, 0 );
		}
		$done  = 0;
		$total = 0;
		foreach ( $lists[1] as $list ) {
			$total += preg_match_all( '#<li\b#i', $list );
			$done  += preg_match_all( '#<li\b[^>]*\bnf-checked\b#i', $list );
		}
		return array( $done, $total );
	}

	/**
	 * The first image in a note, for thumbnails.
	 *
	 * @param string $html HTML.
	 * @return string
	 */
	public static function first_image( $html ) {
		if ( preg_match( '#<img\b[^>]*\bsrc=["\'](https?://[^"\']+)["\']#i', $html, $match ) ) {
			return esc_url_raw( html_entity_decode( $match[1], ENT_QUOTES, 'UTF-8' ) );
		}
		return '';
	}

	/**
	 * Shortens text on a character boundary.
	 *
	 * @param string $text   Text.
	 * @param int    $length Maximum length.
	 * @return string
	 */
	private static function cut( $text, $length ) {
		if ( function_exists( 'mb_strlen' ) ) {
			return mb_strlen( $text ) > $length ? rtrim( mb_substr( $text, 0, $length - 1 ) ) . '…' : $text;
		}
		return strlen( $text ) > $length ? rtrim( substr( $text, 0, $length - 1 ) ) . '…' : $text;
	}

	/**
	 * What the notes list needs to show a note.
	 *
	 * @param WP_Post $post    Note.
	 * @param int     $user_id Person viewing it.
	 * @return array
	 */
	public static function summary( WP_Post $post, $user_id ) {
		$content = self::prepare_content( $post->post_content );
		$text    = self::plain_text( $content );
		$title   = html_entity_decode( $post->post_title, ENT_QUOTES, 'UTF-8' );
		$share   = NoteFlow_Access::get_share( $post->ID );
		$lines   = '' === $text ? array() : explode( "\n", $text );
		$editor  = (int) get_post_meta( $post->ID, self::MODIFIED_BY, true );

		// Untitled notes take their first line as the title, like most notes apps.
		if ( '' === trim( $title ) && $lines ) {
			$title = self::cut( array_shift( $lines ), 100 );
		}

		$summary = array(
			'id'         => $post->ID,
			'title'      => $title,
			'untitled'   => '' === trim( $post->post_title ),
			'excerpt'    => self::cut( implode( ' ', array_slice( $lines, 0, 6 ) ), 160 ),
			'created'    => (int) strtotime( $post->post_date_gmt . ' +0000' ),
			'modified'   => (int) strtotime( $post->post_modified_gmt . ' +0000' ),
			'color'      => self::sanitize_color( get_post_meta( $post->ID, self::COLOR, true ) ),
			'owner'      => (int) $post->post_author,
			'role'       => NoteFlow_Access::role( $post, $user_id ),
			'shared'     => NoteFlow_Access::is_shared( $share ),
			'everyone'   => NoteFlow_Access::everyone_enabled() ? $share['everyone'] : '',
			'status'     => 'trash' === $post->post_status ? 'trash' : 'active',
			'trashed'    => (int) get_post_meta( $post->ID, '_wp_trash_meta_time', true ),
			'tags'       => self::tags( $text ),
			'thumb'      => self::first_image( $content ),
			'checklist'  => self::checklist( $content ),
			'version'    => self::version( $post ),
			'modifiedBy' => $editor ? $editor : (int) $post->post_author,
			'comments'   => NoteFlow_Settings::get( 'comments' ) ? count( (array) get_post_meta( $post->ID, NoteFlow_Comments::META, false ) ) : 0,
			'words'      => '' === $text ? 0 : count( preg_split( '/\s+/u', $text ) ),
			'reminder'   => 0,
			'reminded'   => false,
			'linked'     => null,
		);

		if ( NoteFlow_Settings::module_enabled( 'reminders' ) ) {
			$summary['reminder'] = (int) get_post_meta( $post->ID, self::REMINDER, true );
			$summary['reminded'] = $summary['reminder'] && (int) get_post_meta( $post->ID, self::REMINDER_SENT, true ) >= $summary['reminder'];
		}
		if ( NoteFlow_Settings::module_enabled( 'content_notes' ) ) {
			$summary['linked'] = self::linked_info( (int) get_post_meta( $post->ID, self::LINKED, true ) );
		}

		/**
		 * Filters a note summary sent to the notes app.
		 *
		 * @param array   $summary Summary.
		 * @param WP_Post $post    Note.
		 * @param int     $user_id Viewer.
		 */
		return apply_filters( 'noteflow_note_summary', $summary, $post, $user_id );
	}

	/**
	 * Everything the editor needs: the summary plus content, permissions and people.
	 *
	 * @param WP_Post $post    Note.
	 * @param int     $user_id Person viewing it.
	 * @return array
	 */
	public static function full( WP_Post $post, $user_id ) {
		$note  = self::summary( $post, $user_id );
		$role  = $note['role'];
		$share = NoteFlow_Access::get_share( $post->ID );
		$pins  = NoteFlow_User_State::pins( $user_id );
		$filed = NoteFlow_User_State::filed( $user_id );

		$people = array(
			array(
				'id'   => (int) $post->post_author,
				'role' => 'owner',
			),
		);
		if ( NoteFlow_Access::sharing_enabled() ) {
			foreach ( $share['users'] as $uid => $user_role ) {
				if ( (int) $post->post_author !== $uid ) {
					$people[] = array(
						'id'   => $uid,
						'role' => $user_role,
					);
				}
			}
		}

		$note['content']       = self::prepare_content( $post->post_content );
		$note['titleRaw']      = html_entity_decode( $post->post_title, ENT_QUOTES, 'UTF-8' );
		$note['collaborators'] = $people;
		$note['pinned']        = in_array( $post->ID, $pins, true );
		$note['folder']        = isset( $filed[ $post->ID ] ) ? $filed[ $post->ID ] : '';
		$note['can']           = array(
			'edit'    => NoteFlow_Access::role_can_edit( $role ) && 'trash' !== $post->post_status,
			'share'   => 'owner' === $role && NoteFlow_Access::sharing_enabled() && 'trash' !== $post->post_status,
			'delete'  => 'owner' === $role,
			'comment' => (bool) NoteFlow_Settings::get( 'comments' ) && 'trash' !== $post->post_status,
		);

		return $note;
	}

	/**
	 * Names and avatars for people shown in the app.
	 *
	 * @param int[] $ids User IDs.
	 * @return array<int,array>
	 */
	public static function people( $ids ) {
		$ids    = array_values( array_unique( array_filter( array_map( 'intval', (array) $ids ) ) ) );
		$people = array();
		if ( ! $ids ) {
			return $people;
		}

		$avatars = (bool) get_option( 'show_avatars' );
		foreach ( get_users(
			array(
				'include' => $ids,
				'fields'  => array( 'ID', 'display_name' ),
			)
		) as $user ) {
			$people[ (int) $user->ID ] = array(
				'id'     => (int) $user->ID,
				'name'   => html_entity_decode( $user->display_name, ENT_QUOTES, 'UTF-8' ),
				'avatar' => $avatars ? (string) get_avatar_url(
					$user->ID,
					array(
						'size'    => 64,
						'default' => '404',
					)
				) : '',
			);
		}
		return $people;
	}

	/**
	 * User IDs mentioned by a list of summaries (owners and last editors).
	 *
	 * @param array[] $summaries Summaries.
	 * @return int[]
	 */
	public static function people_in( $summaries ) {
		$ids = array();
		foreach ( $summaries as $summary ) {
			$ids[] = $summary['owner'];
			$ids[] = $summary['modifiedBy'];
			if ( isset( $summary['collaborators'] ) ) {
				foreach ( $summary['collaborators'] as $person ) {
					$ids[] = $person['id'];
				}
			}
		}
		return $ids;
	}

	/**
	 * The post a note is attached to, as the viewer may see it.
	 *
	 * @param int $post_id Post ID.
	 * @return array|null
	 */
	public static function linked_info( $post_id ) {
		$linked = $post_id ? get_post( $post_id ) : null;
		if ( ! $linked || 'trash' === $linked->post_status || self::POST_TYPE === $linked->post_type ) {
			return null;
		}

		$type     = get_post_type_object( $linked->post_type );
		$can_read = current_user_can( 'read_post', $linked->ID );
		$title    = trim( html_entity_decode( $linked->post_title, ENT_QUOTES, 'UTF-8' ) );

		return array(
			'id'    => $linked->ID,
			'title' => $can_read ? ( '' === $title ? __( '(no title)', 'noteflow' ) : $title ) : __( 'A private item', 'noteflow' ),
			'type'  => $type ? $type->labels->singular_name : '',
			'edit'  => current_user_can( 'edit_post', $linked->ID ) ? (string) get_edit_post_link( $linked->ID, 'raw' ) : '',
			'view'  => ( $can_read && $type && is_post_type_viewable( $type ) && 'publish' === $linked->post_status ) ? (string) get_permalink( $linked ) : '',
		);
	}

	/**
	 * Creates a note.
	 *
	 * @param int   $user_id Owner.
	 * @param array $args    title, content, color, folder, linked, revision.
	 * @return WP_Post|WP_Error
	 */
	public static function create( $user_id, $args ) {
		$args = wp_parse_args(
			$args,
			array(
				'title'    => '',
				'content'  => '',
				'color'    => '',
				'folder'   => '',
				'linked'   => 0,
				'revision' => true,
			)
		);

		$id = wp_insert_post(
			wp_slash(
				array(
					'post_type'    => self::POST_TYPE,
					'post_status'  => 'publish',
					'post_author'  => (int) $user_id,
					'post_title'   => self::sanitize_title( $args['title'] ),
					'post_content' => self::sanitize_content( $args['content'] ),
					'menu_order'   => 1,
				)
			),
			true
		);
		if ( is_wp_error( $id ) ) {
			return $id;
		}

		add_post_meta( $id, self::MODIFIED_BY, (int) $user_id, true );

		$color = self::sanitize_color( $args['color'] );
		if ( $color ) {
			add_post_meta( $id, self::COLOR, $color, true );
		}
		if ( '' !== (string) $args['folder'] ) {
			NoteFlow_User_State::file_note( $user_id, $id, (string) $args['folder'] );
		}
		if ( $args['linked'] ) {
			update_post_meta( $id, self::LINKED, (int) $args['linked'] );
		}
		if ( $args['revision'] && ( '' !== trim( $args['title'] ) || '' !== trim( wp_strip_all_tags( $args['content'] ) ) ) ) {
			// The first revision records the note as it was created, by its owner.
			wp_save_post_revision( $id );
		}

		self::flush_access_cache();
		return get_post( $id );
	}

	/**
	 * Saves a new title and/or content.
	 *
	 * Each save names the version it started from. The content and the next version are
	 * written in one conditional UPDATE, so two saves can never both win, and nobody can
	 * read a version number without the content that goes with it. A save that started
	 * from an old version is refused with a 409 and the latest note, and the app merges.
	 *
	 * The row is updated directly rather than through wp_update_post(), so autosaves
	 * don't run every save_post handler on the site several times a minute.
	 *
	 * @param WP_Post $post         Note.
	 * @param int     $user_id      Person saving.
	 * @param array   $fields       'title' and/or 'content', already cleaned.
	 * @param int     $base_version Version the changes were made on.
	 * @param bool    $force        Save even if the note changed since.
	 * @return WP_Post|WP_Error
	 */
	public static function update_content( WP_Post $post, $user_id, $fields, $base_version, $force = false ) {
		global $wpdb;

		$row = $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare( "SELECT post_title, post_content, menu_order FROM {$wpdb->posts} WHERE ID = %d", $post->ID )
		);
		if ( ! $row ) {
			return new WP_Error( 'noteflow_not_found', __( 'This note does not exist, or it is no longer shared with you.', 'noteflow' ), array( 'status' => 404 ) );
		}

		$stored  = (int) $row->menu_order;
		$current = max( 1, $stored );
		if ( ! $force && (int) $base_version !== $current ) {
			return self::conflict( $post->ID, $user_id );
		}

		self::snapshot_before( $post->ID, $user_id );

		$updated = $wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				"UPDATE {$wpdb->posts} SET post_title = %s, post_content = %s, post_modified = %s, post_modified_gmt = %s, menu_order = %d WHERE ID = %d AND menu_order = %d",
				array_key_exists( 'title', $fields ) ? $fields['title'] : $row->post_title,
				array_key_exists( 'content', $fields ) ? $fields['content'] : $row->post_content,
				current_time( 'mysql' ),
				current_time( 'mysql', true ),
				$current + 1,
				$post->ID,
				$stored
			)
		);
		clean_post_cache( $post->ID );

		if ( 1 !== (int) $updated ) {
			return self::conflict( $post->ID, $user_id );
		}

		update_post_meta( $post->ID, self::MODIFIED_BY, (int) $user_id );
		wp_save_post_revision( $post->ID );

		/**
		 * Fires after a note's title or content is saved.
		 *
		 * @param int $note_id Note ID.
		 * @param int $user_id Person who saved it.
		 */
		do_action( 'noteflow_note_saved', $post->ID, (int) $user_id );

		return get_post( $post->ID );
	}

	/**
	 * Before someone saves over another person's work, keeps that work as a revision
	 * credited to them. Their own saves are only kept every ten minutes, so without
	 * this the history could skip straight from an early version to the new editor's.
	 *
	 * @param int $note_id Note ID.
	 * @param int $user_id Person about to save.
	 */
	private static function snapshot_before( $note_id, $user_id ) {
		global $wpdb;

		$previous = (int) get_post_meta( $note_id, self::MODIFIED_BY, true );
		$post     = get_post( $note_id );
		if ( ! $post || ! $previous || $previous === (int) $user_id || ( '' === $post->post_content && '' === $post->post_title ) ) {
			return;
		}

		$latest = wp_get_post_revisions(
			$note_id,
			array(
				'posts_per_page' => 1,
				'check_enabled'  => false,
			)
		);
		$latest = $latest ? reset( $latest ) : null;
		if ( $latest && $latest->post_content === $post->post_content && $latest->post_title === $post->post_title ) {
			return;
		}

		$revision = _wp_put_post_revision( $post );
		if ( $revision && ! is_wp_error( $revision ) ) {
			$wpdb->update( $wpdb->posts, array( 'post_author' => $previous ), array( 'ID' => (int) $revision ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			clean_post_cache( (int) $revision );
		}
	}

	/**
	 * The error for a save that started from an old version, with the latest note.
	 *
	 * @param int $note_id Note ID.
	 * @param int $user_id Person saving.
	 * @return WP_Error
	 */
	private static function conflict( $note_id, $user_id ) {
		clean_post_cache( $note_id );
		$latest = self::full( get_post( $note_id ), $user_id );

		return new WP_Error(
			'noteflow_conflict',
			__( 'This note changed while you were editing it.', 'noteflow' ),
			array(
				'status' => 409,
				'note'   => $latest,
				'people' => self::people( array( $latest['modifiedBy'] ) ),
			)
		);
	}

	/**
	 * Marks a note as changed without a new revision, for colours, reminders and links.
	 *
	 * @param int $note_id Note ID.
	 */
	public static function touch( $note_id ) {
		global $wpdb;
		$wpdb->update( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->posts,
			array(
				'post_modified'     => current_time( 'mysql' ),
				'post_modified_gmt' => current_time( 'mysql', true ),
			),
			array( 'ID' => (int) $note_id )
		);
		clean_post_cache( $note_id );
	}

	/**
	 * Copies a note for a user, who owns the copy.
	 *
	 * @param WP_Post $post    Note to copy.
	 * @param int     $user_id New owner.
	 * @return WP_Post|WP_Error
	 */
	public static function duplicate( WP_Post $post, $user_id ) {
		$filed = NoteFlow_User_State::filed( $user_id );

		return self::create(
			$user_id,
			array(
				'title'   => html_entity_decode( $post->post_title, ENT_QUOTES, 'UTF-8' ),
				'content' => self::prepare_content( $post->post_content ),
				'color'   => get_post_meta( $post->ID, self::COLOR, true ),
				'folder'  => isset( $filed[ $post->ID ] ) ? $filed[ $post->ID ] : '',
			)
		);
	}

	/**
	 * Full-text search across the notes a user can open.
	 *
	 * @param int    $user_id User ID.
	 * @param string $query   Search terms.
	 * @return array[] Each with 'id' and 'snippet'.
	 */
	public static function search( $user_id, $query ) {
		$ids = self::accessible_ids( $user_id, false );
		if ( ! $ids || '' === trim( $query ) ) {
			return array();
		}

		$found = get_posts(
			array(
				'post_type'              => self::POST_TYPE,
				'post_status'            => 'publish',
				'post__in'               => $ids,
				's'                      => $query,
				'posts_per_page'         => 200, // phpcs:ignore WordPress.WP.PostsPerPage.posts_per_page_posts_per_page -- Search results for one person's notes.
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
			)
		);

		$results = array();
		foreach ( $found as $post ) {
			$results[] = array(
				'id'      => $post->ID,
				'snippet' => self::snippet( self::plain_text( self::prepare_content( $post->post_content ) ), $query ),
			);
		}
		return $results;
	}

	/**
	 * The part of a note around the first match.
	 *
	 * @param string $text  Plain text.
	 * @param string $query Search terms.
	 * @return string
	 */
	private static function snippet( $text, $query ) {
		$text = str_replace( "\n", ' ', $text );
		if ( ! function_exists( 'mb_stripos' ) ) {
			return self::cut( $text, 160 );
		}

		$pos = false;
		foreach ( preg_split( '/\s+/u', trim( $query ) ) as $term ) {
			$pos = mb_stripos( $text, $term );
			if ( false !== $pos ) {
				break;
			}
		}
		if ( false === $pos || $pos < 50 ) {
			return self::cut( $text, 160 );
		}
		return '…' . self::cut( ltrim( mb_substr( $text, $pos - 40 ) ), 160 );
	}

	/**
	 * Deletes the user's notes that were created and left completely empty more than an
	 * hour ago, like a new note closed before anything was typed.
	 *
	 * @param int $user_id User ID.
	 */
	public static function delete_abandoned( $user_id ) {
		global $wpdb;
		$ids = $wpdb->get_col( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_author = %d AND post_status = 'publish' AND post_title = '' AND post_content = '' AND post_date_gmt < %s LIMIT 50",
				self::POST_TYPE,
				(int) $user_id,
				gmdate( 'Y-m-d H:i:s', time() - HOUR_IN_SECONDS )
			)
		);
		foreach ( $ids as $id ) {
			if ( ! get_post_meta( (int) $id, NoteFlow_Comments::META, false ) ) {
				wp_delete_post( (int) $id, true );
			}
		}
		if ( $ids ) {
			self::flush_access_cache();
		}
	}

	/**
	 * Creates a welcome note the first time someone opens NoteFlow with no notes.
	 *
	 * @param int $user_id User ID.
	 */
	public static function maybe_create_welcome( $user_id ) {
		if ( get_user_option( 'noteflow_welcomed', $user_id ) ) {
			return;
		}
		update_user_option( $user_id, 'noteflow_welcomed', time() );

		$owned = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => array( 'publish', 'trash' ),
				'author'         => $user_id,
				'posts_per_page' => 1,
				'fields'         => 'ids',
			)
		);
		if ( $owned ) {
			return;
		}

		$content  = '<p>' . esc_html__( 'NoteFlow keeps your notes, checklists and ideas right inside WordPress. A few things to try:', 'noteflow' ) . '</p>';
		$content .= '<ul class="nf-checklist">';
		$content .= '<li class="nf-checked">' . esc_html__( 'Open NoteFlow', 'noteflow' ) . '</li>';
		$content .= '<li>' . esc_html__( 'Create a note with the compose button, or press N', 'noteflow' ) . '</li>';
		$content .= '<li>' . esc_html__( 'Type [] and a space to start a checklist like this one', 'noteflow' ) . '</li>';
		$content .= '<li>' . esc_html__( 'Add a #tag anywhere in a note to group it with others', 'noteflow' ) . '</li>';
		$content .= '<li>' . esc_html__( 'Share a note with your team from the Share button', 'noteflow' ) . '</li>';
		$content .= '</ul>';
		$content .= '<h2>' . esc_html__( 'Formatting', 'noteflow' ) . '</h2>';
		$content .= '<p>' . esc_html__( 'Use the Aa menu for titles, headings, lists and monospaced text. Shortcuts work as you type, too:', 'noteflow' ) . '</p>';
		$content .= '<ul><li><code># </code> ' . esc_html__( 'heading', 'noteflow' ) . '</li><li><code>- </code> ' . esc_html__( 'bulleted list', 'noteflow' ) . '</li><li><code>1. </code> ' . esc_html__( 'numbered list', 'noteflow' ) . '</li><li><code>&gt; </code> ' . esc_html__( 'quote', 'noteflow' ) . '</li></ul>';
		$content .= '<p>' . esc_html__( 'Press ? at any time to see every keyboard shortcut.', 'noteflow' ) . ' #noteflow</p>';

		self::create(
			$user_id,
			array(
				'title'   => __( 'Welcome to NoteFlow', 'noteflow' ),
				'content' => $content,
			)
		);
	}
}
