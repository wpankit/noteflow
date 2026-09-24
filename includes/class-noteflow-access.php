<?php
/**
 * Who can use NoteFlow, and what each person can do with a note.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Access rules.
 *
 * A note belongs to its author (the owner). The owner can share it with people as
 * viewers or editors, or with everyone who can use NoteFlow. Only the owner can
 * share, move to Recently Deleted, or delete a note. Nobody else sees it.
 */
class NoteFlow_Access {

	const SHARE_VIEW = '_noteflow_share_view';
	const SHARE_EDIT = '_noteflow_share_edit';
	const EVERYONE   = '_noteflow_everyone';

	/**
	 * Whether a user can use NoteFlow at all.
	 *
	 * @param WP_User|int|null $user User or ID; defaults to the current user.
	 * @return bool
	 */
	public static function can_use( $user = null ) {
		if ( null === $user ) {
			$user = wp_get_current_user();
		} elseif ( ! $user instanceof WP_User ) {
			$user = get_userdata( (int) $user );
		}

		if ( ! $user instanceof WP_User || ! $user->exists() ) {
			return false;
		}

		$allowed = user_can( $user, 'manage_options' )
			|| ( is_multisite() && is_super_admin( $user->ID ) )
			|| (bool) array_intersect( (array) $user->roles, (array) NoteFlow_Settings::get( 'roles' ) );

		/**
		 * Filters whether a user can use NoteFlow.
		 *
		 * @param bool    $allowed Whether the user's role is allowed in Settings.
		 * @param WP_User $user    The user.
		 */
		return (bool) apply_filters( 'noteflow_user_can_use', $allowed, $user );
	}

	/**
	 * Whether sharing is switched on.
	 *
	 * @return bool
	 */
	public static function sharing_enabled() {
		return (bool) NoteFlow_Settings::get( 'sharing' );
	}

	/**
	 * Whether notes can be shared with everyone at once.
	 *
	 * @return bool
	 */
	public static function everyone_enabled() {
		return self::sharing_enabled() && (bool) NoteFlow_Settings::get( 'share_everyone' );
	}

	/**
	 * A user's role on a note: 'owner', 'edit', 'view', or '' for no access.
	 *
	 * Only the owner can reach a note in Recently Deleted.
	 *
	 * @param WP_Post|int $post    Note.
	 * @param int         $user_id User ID; defaults to the current user.
	 * @return string
	 */
	public static function role( $post, $user_id = 0 ) {
		$post    = get_post( $post );
		$user_id = $user_id ? (int) $user_id : get_current_user_id();

		if ( ! $post || NoteFlow_Post_Type::NAME !== $post->post_type || ! $user_id || ! self::can_use( $user_id ) ) {
			return '';
		}

		$role = '';
		if ( (int) $post->post_author === $user_id ) {
			$role = 'owner';
		} elseif ( 'publish' === $post->post_status && self::sharing_enabled() ) {
			$share = self::get_share( $post->ID );
			if ( isset( $share['users'][ $user_id ] ) ) {
				$role = $share['users'][ $user_id ];
			}
			if ( 'edit' !== $role && '' !== $share['everyone'] && self::everyone_enabled() ) {
				$role = ( 'edit' === $share['everyone'] ) ? 'edit' : ( '' === $role ? 'view' : $role );
			}
		}

		/**
		 * Filters a user's role on a note.
		 *
		 * @param string  $role    'owner', 'edit', 'view' or ''.
		 * @param WP_Post $post    The note.
		 * @param int     $user_id The user.
		 */
		return (string) apply_filters( 'noteflow_note_role', $role, $post, $user_id );
	}

	/**
	 * Whether a role can change a note's content.
	 *
	 * @param string $role Role from role().
	 * @return bool
	 */
	public static function role_can_edit( $role ) {
		return in_array( $role, array( 'owner', 'edit' ), true );
	}

	/**
	 * Sharing for a note.
	 *
	 * @param int $note_id Note ID.
	 * @return array{everyone:string,users:array<int,string>} Users map user ID => 'view'|'edit'.
	 */
	public static function get_share( $note_id ) {
		$users = array();
		foreach ( (array) get_post_meta( $note_id, self::SHARE_VIEW, false ) as $uid ) {
			$users[ (int) $uid ] = 'view';
		}
		foreach ( (array) get_post_meta( $note_id, self::SHARE_EDIT, false ) as $uid ) {
			$users[ (int) $uid ] = 'edit';
		}
		unset( $users[0] );

		$everyone = (string) get_post_meta( $note_id, self::EVERYONE, true );

		return array(
			'everyone' => in_array( $everyone, array( 'view', 'edit' ), true ) ? $everyone : '',
			'users'    => $users,
		);
	}

	/**
	 * Replaces a note's sharing.
	 *
	 * @param int               $note_id  Note ID.
	 * @param string            $everyone '', 'view' or 'edit'.
	 * @param array<int,string> $users    User ID => 'view'|'edit'.
	 */
	public static function set_share( $note_id, $everyone, $users ) {
		delete_post_meta( $note_id, self::SHARE_VIEW );
		delete_post_meta( $note_id, self::SHARE_EDIT );

		foreach ( $users as $uid => $role ) {
			add_post_meta( $note_id, 'edit' === $role ? self::SHARE_EDIT : self::SHARE_VIEW, (int) $uid );
		}

		if ( in_array( $everyone, array( 'view', 'edit' ), true ) ) {
			update_post_meta( $note_id, self::EVERYONE, $everyone );
		} else {
			delete_post_meta( $note_id, self::EVERYONE );
		}
	}

	/**
	 * Whether anyone besides the owner can open the note.
	 *
	 * @param array $share Result of get_share().
	 * @return bool
	 */
	public static function is_shared( $share ) {
		if ( ! self::sharing_enabled() ) {
			return false;
		}
		return ! empty( $share['users'] ) || ( '' !== $share['everyone'] && self::everyone_enabled() );
	}

	/**
	 * Roles that can use NoteFlow, for user searches.
	 *
	 * @return string[]
	 */
	public static function allowed_roles() {
		return array_values( array_unique( array_merge( array( 'administrator' ), (array) NoteFlow_Settings::get( 'roles' ) ) ) );
	}
}
