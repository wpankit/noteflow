<?php
/**
 * Each person's own organisation: folders, pins and preferences.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Per-user state, kept as user options, so each site in a network has its own.
 *
 * Folders and pins are personal: when a note is shared, each person files and pins
 * it in their own way, the way shared notes work in most notes apps.
 */
class NoteFlow_User_State {

	const FOLDERS = 'noteflow_folders';
	const FILED   = 'noteflow_filed';
	const PINS    = 'noteflow_pins';
	const PREFS   = 'noteflow_prefs';

	const MAX_FOLDERS = 200;

	/**
	 * The user's folders, in their order.
	 *
	 * @param int $user_id User ID.
	 * @return array<int,array{id:string,name:string}>
	 */
	public static function folders( $user_id ) {
		$folders = get_user_option( self::FOLDERS, $user_id );
		$clean   = array();
		foreach ( is_array( $folders ) ? $folders : array() as $folder ) {
			if ( isset( $folder['id'], $folder['name'] ) && is_string( $folder['id'] ) ) {
				$clean[] = array(
					'id'   => (string) $folder['id'],
					'name' => (string) $folder['name'],
				);
			}
		}
		return $clean;
	}

	/**
	 * Cleans a folder name.
	 *
	 * @param string $name Raw name.
	 * @return string
	 */
	private static function clean_name( $name ) {
		$name = trim( sanitize_text_field( (string) $name ) );
		return function_exists( 'mb_substr' ) ? mb_substr( $name, 0, 60 ) : substr( $name, 0, 60 );
	}

	/**
	 * Whether the user already has a folder with this name.
	 *
	 * @param array  $folders Folders.
	 * @param string $name    Name to check.
	 * @param string $skip    Folder ID to ignore (when renaming).
	 * @return bool
	 */
	private static function name_taken( $folders, $name, $skip = '' ) {
		$lower = function_exists( 'mb_strtolower' ) ? 'mb_strtolower' : 'strtolower';
		foreach ( $folders as $folder ) {
			if ( $folder['id'] !== $skip && $lower( $folder['name'] ) === $lower( $name ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Creates a folder.
	 *
	 * @param int    $user_id User ID.
	 * @param string $name    Folder name.
	 * @return array|WP_Error The new folder.
	 */
	public static function add_folder( $user_id, $name ) {
		$name    = self::clean_name( $name );
		$folders = self::folders( $user_id );

		if ( '' === $name ) {
			return new WP_Error( 'noteflow_folder_name', __( 'Give the folder a name.', 'noteflow' ), array( 'status' => 400 ) );
		}
		if ( self::name_taken( $folders, $name ) ) {
			return new WP_Error( 'noteflow_folder_exists', __( 'You already have a folder with that name.', 'noteflow' ), array( 'status' => 400 ) );
		}
		if ( count( $folders ) >= self::MAX_FOLDERS ) {
			return new WP_Error( 'noteflow_folder_limit', __( 'You have reached the folder limit.', 'noteflow' ), array( 'status' => 400 ) );
		}

		$folder    = array(
			'id'   => 'f' . strtolower( wp_generate_password( 10, false ) ),
			'name' => $name,
		);
		$folders[] = $folder;
		update_user_option( $user_id, self::FOLDERS, $folders );

		return $folder;
	}

	/**
	 * Renames a folder.
	 *
	 * @param int    $user_id   User ID.
	 * @param string $folder_id Folder ID.
	 * @param string $name      New name.
	 * @return true|WP_Error
	 */
	public static function rename_folder( $user_id, $folder_id, $name ) {
		$name    = self::clean_name( $name );
		$folders = self::folders( $user_id );
		$found   = false;

		if ( '' === $name ) {
			return new WP_Error( 'noteflow_folder_name', __( 'Give the folder a name.', 'noteflow' ), array( 'status' => 400 ) );
		}
		if ( self::name_taken( $folders, $name, $folder_id ) ) {
			return new WP_Error( 'noteflow_folder_exists', __( 'You already have a folder with that name.', 'noteflow' ), array( 'status' => 400 ) );
		}

		foreach ( $folders as $i => $folder ) {
			if ( $folder['id'] === $folder_id ) {
				$folders[ $i ]['name'] = $name;
				$found                 = true;
			}
		}
		if ( ! $found ) {
			return new WP_Error( 'noteflow_folder_missing', __( 'That folder no longer exists.', 'noteflow' ), array( 'status' => 404 ) );
		}

		update_user_option( $user_id, self::FOLDERS, $folders );
		return true;
	}

	/**
	 * Deletes a folder. Its notes go back to the default Notes folder.
	 *
	 * @param int    $user_id   User ID.
	 * @param string $folder_id Folder ID.
	 */
	public static function delete_folder( $user_id, $folder_id ) {
		$folders = array_values(
			array_filter(
				self::folders( $user_id ),
				function ( $folder ) use ( $folder_id ) {
					return $folder['id'] !== $folder_id;
				}
			)
		);
		update_user_option( $user_id, self::FOLDERS, $folders );

		$filed = array_filter(
			self::filed( $user_id ),
			function ( $id ) use ( $folder_id ) {
				return $id !== $folder_id;
			}
		);
		update_user_option( $user_id, self::FILED, $filed );
	}

	/**
	 * Puts folders in a new order.
	 *
	 * @param int      $user_id User ID.
	 * @param string[] $order   Folder IDs in the new order.
	 */
	public static function reorder_folders( $user_id, $order ) {
		$folders = self::folders( $user_id );
		$byid    = array();
		foreach ( $folders as $folder ) {
			$byid[ $folder['id'] ] = $folder;
		}

		$sorted = array();
		foreach ( (array) $order as $id ) {
			if ( isset( $byid[ $id ] ) ) {
				$sorted[] = $byid[ $id ];
				unset( $byid[ $id ] );
			}
		}
		update_user_option( $user_id, self::FOLDERS, array_merge( $sorted, array_values( $byid ) ) );
	}

	/**
	 * Which folder each note is filed in, for this user.
	 *
	 * @param int $user_id User ID.
	 * @return array<int,string> Note ID => folder ID.
	 */
	public static function filed( $user_id ) {
		$filed = get_user_option( self::FILED, $user_id );
		$clean = array();
		foreach ( is_array( $filed ) ? $filed : array() as $note_id => $folder_id ) {
			if ( (int) $note_id > 0 && is_string( $folder_id ) && '' !== $folder_id ) {
				$clean[ (int) $note_id ] = $folder_id;
			}
		}
		return $clean;
	}

	/**
	 * Files a note in one of the user's folders, or back in Notes with ''.
	 *
	 * @param int    $user_id   User ID.
	 * @param int    $note_id   Note ID.
	 * @param string $folder_id Folder ID or ''.
	 * @return true|WP_Error
	 */
	public static function file_note( $user_id, $note_id, $folder_id ) {
		$filed = self::filed( $user_id );

		if ( '' === $folder_id ) {
			unset( $filed[ $note_id ] );
		} else {
			$ids = wp_list_pluck( self::folders( $user_id ), 'id' );
			if ( ! in_array( $folder_id, $ids, true ) ) {
				return new WP_Error( 'noteflow_folder_missing', __( 'That folder no longer exists.', 'noteflow' ), array( 'status' => 404 ) );
			}
			$filed[ $note_id ] = $folder_id;
		}

		update_user_option( $user_id, self::FILED, $filed );
		return true;
	}

	/**
	 * The user's pinned notes.
	 *
	 * @param int $user_id User ID.
	 * @return int[]
	 */
	public static function pins( $user_id ) {
		$pins = get_user_option( self::PINS, $user_id );
		return array_values( array_unique( array_filter( array_map( 'intval', is_array( $pins ) ? $pins : array() ) ) ) );
	}

	/**
	 * Pins or unpins a note for this user.
	 *
	 * @param int  $user_id User ID.
	 * @param int  $note_id Note ID.
	 * @param bool $pinned  Pin state.
	 */
	public static function set_pin( $user_id, $note_id, $pinned ) {
		$pins = array_diff( self::pins( $user_id ), array( (int) $note_id ) );
		if ( $pinned ) {
			array_unshift( $pins, (int) $note_id );
		}
		update_user_option( $user_id, self::PINS, array_values( $pins ) );
	}

	/**
	 * Forgets pins and filing for notes the user can no longer open.
	 *
	 * @param int   $user_id    User ID.
	 * @param int[] $accessible IDs of notes the user can open.
	 */
	public static function prune( $user_id, $accessible ) {
		$keep = array_flip( $accessible );

		$pins = self::pins( $user_id );
		$kept = array_values(
			array_filter(
				$pins,
				function ( $id ) use ( $keep ) {
					return isset( $keep[ $id ] );
				}
			)
		);
		if ( count( $kept ) !== count( $pins ) ) {
			update_user_option( $user_id, self::PINS, $kept );
		}

		$filed = self::filed( $user_id );
		$kept  = array_intersect_key( $filed, $keep );
		if ( count( $kept ) !== count( $filed ) ) {
			update_user_option( $user_id, self::FILED, $kept );
		}
	}

	/**
	 * Default preferences.
	 *
	 * @return array
	 */
	public static function default_prefs() {
		return array(
			'theme'     => 'light',
			'view'      => 'list',
			'sort'      => 'modified',
			'group'     => true,
			'emails'    => true,
			'collapsed' => false,
		);
	}

	/**
	 * The user's preferences.
	 *
	 * @param int $user_id User ID.
	 * @return array
	 */
	public static function prefs( $user_id ) {
		$prefs = get_user_option( self::PREFS, $user_id );
		return array_merge( self::default_prefs(), is_array( $prefs ) ? $prefs : array() );
	}

	/**
	 * Saves preferences, ignoring unknown keys and values.
	 *
	 * @param int   $user_id User ID.
	 * @param array $changes Preferences to change.
	 * @return array All preferences.
	 */
	public static function update_prefs( $user_id, $changes ) {
		$prefs   = self::prefs( $user_id );
		$choices = array(
			'theme' => array( 'light', 'dark', 'auto' ),
			'view'  => array( 'list', 'gallery' ),
			'sort'  => array( 'modified', 'created', 'title' ),
		);

		foreach ( $choices as $key => $allowed ) {
			if ( isset( $changes[ $key ] ) && in_array( $changes[ $key ], $allowed, true ) ) {
				$prefs[ $key ] = $changes[ $key ];
			}
		}
		foreach ( array( 'group', 'emails', 'collapsed' ) as $key ) {
			if ( isset( $changes[ $key ] ) ) {
				$prefs[ $key ] = (bool) $changes[ $key ];
			}
		}

		update_user_option( $user_id, self::PREFS, $prefs );
		return $prefs;
	}
}
