<?php
/**
 * Upgrades from NoteFlow 1.x.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Moves 1.x data to the 2.0 model without changing who can see what.
 *
 * In 1.x every NoteFlow user could see and edit every note. 2.0 makes new notes
 * private, so notes from 1.x are marked as shared with everyone (can edit) to keep
 * working as before. Their owners can make them private from the Share button.
 */
class NoteFlow_Upgrade {

	const OPTION        = 'noteflow_db_version';
	const LEGACY_OPTION = 'noteflow_legacy_notes';
	const NOTICE        = '2.0';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'maybe_upgrade' ), 20 );
	}

	/**
	 * Runs any upgrade this site hasn't had yet.
	 */
	public static function maybe_upgrade() {
		$installed = (string) get_option( self::OPTION, '' );
		if ( '' !== $installed && version_compare( $installed, '2.0.0', '>=' ) ) {
			return;
		}

		// 1.x never stored a version, so '' means a new install or an upgrade from 1.x.
		if ( '' === $installed ) {
			self::from_1x();
		}

		update_option( self::OPTION, NOTEFLOW_VERSION, true );
	}

	/**
	 * Whether a person upgraded from 1.x should still see the notice about what changed.
	 * Dismissing it once covers every 2.0 update; a later notice gets a new NOTICE.
	 *
	 * @param int $user_id User ID.
	 * @return bool
	 */
	public static function show_notice( $user_id ) {
		if ( (int) get_option( self::LEGACY_OPTION, 0 ) <= 0 ) {
			return false;
		}
		$seen = (string) get_user_option( 'noteflow_upgrade_seen', $user_id );
		return '' === $seen || version_compare( $seen, self::NOTICE, '<' );
	}

	/**
	 * Migrates notes, pins, colours and categories from 1.x.
	 */
	private static function from_1x() {
		global $wpdb;

		$notes = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare( "SELECT ID, post_author FROM {$wpdb->posts} WHERE post_type = %s", NoteFlow_Post_Type::NAME )
		);

		foreach ( $notes as $note ) {
			$id = (int) $note->ID;

			if ( ! metadata_exists( 'post', $id, NoteFlow_Access::EVERYONE ) ) {
				add_post_meta( $id, NoteFlow_Access::EVERYONE, 'edit', true );
			}

			// 1.x colours were pale backgrounds; 2.0 shows a coloured dot, so pick the closest strong colour.
			$color = self::palette_color( (string) get_post_meta( $id, NoteFlow_Notes::COLOR, true ) );
			if ( '' === $color ) {
				delete_post_meta( $id, NoteFlow_Notes::COLOR );
			} else {
				update_post_meta( $id, NoteFlow_Notes::COLOR, $color );
			}

			// Pins were shared by everyone; now each person has their own. Keep the author's.
			if ( get_post_meta( $id, '_note_pinned', true ) ) {
				NoteFlow_User_State::set_pin( (int) $note->post_author, $id, true );
			}
			delete_post_meta( $id, '_note_pinned' );
		}

		if ( $notes ) {
			update_option( self::LEGACY_OPTION, count( $notes ), false );
			self::categories_to_folders();
		}

		delete_option( 'noteflow_pluginstack_promo_dismissed' );

		// 1.x bundled Freemius, which registered its own uninstall callback. NoteFlow
		// now ships an uninstall.php, which WordPress prefers, but drop the stale entry.
		$hooks = get_option( 'uninstall_plugins' );
		$file  = plugin_basename( NOTEFLOW_FILE );
		if ( is_array( $hooks ) && isset( $hooks[ $file ] ) ) {
			unset( $hooks[ $file ] );
			update_option( 'uninstall_plugins', $hooks );
		}
	}

	/**
	 * The 2.0 palette colour closest in hue to a 1.x colour. White and near-white mean none.
	 *
	 * @param string $hex 1.x colour.
	 * @return string Palette colour, or ''.
	 */
	public static function palette_color( $hex ) {
		$hex = sanitize_hex_color( strtolower( trim( $hex ) ) );
		if ( ! $hex ) {
			return '';
		}
		$hex = ltrim( $hex, '#' );
		if ( 3 === strlen( $hex ) ) {
			$hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
		}
		$r = hexdec( substr( $hex, 0, 2 ) ) / 255;
		$g = hexdec( substr( $hex, 2, 2 ) ) / 255;
		$b = hexdec( substr( $hex, 4, 2 ) ) / 255;

		$max = max( $r, $g, $b );
		$min = min( $r, $g, $b );
		$l   = ( $max + $min ) / 2;
		$d   = $max - $min;
		if ( $l > 0.985 ) {
			return '';
		}
		$s = 0.0 === (float) $d ? 0 : $d / ( 1 - abs( 2 * $l - 1 ) );
		if ( $s < 0.12 ) {
			return $l > 0.85 ? '' : '#8e8e93';
		}
		if ( $max === $r ) {
			$h = 60 * fmod( ( $g - $b ) / $d, 6 );
		} elseif ( $max === $g ) {
			$h = 60 * ( ( $b - $r ) / $d + 2 );
		} else {
			$h = 60 * ( ( $r - $g ) / $d + 4 );
		}
		$h = $h < 0 ? $h + 360 : $h;

		$hues = array(
			15  => '#ff5f57',
			40  => '#ff9f0a',
			70  => '#f5c400',
			170 => '#30c85e',
			255 => '#3d8bfd',
			330 => '#a86bf5',
			361 => '#ff5f57',
		);
		foreach ( $hues as $limit => $color ) {
			if ( $h < $limit ) {
				return $color;
			}
		}
		return '#ff5f57';
	}

	/**
	 * 1.x registered note categories without a screen to manage them. If a site added
	 * some anyway, each note's author gets a folder with the same name.
	 */
	private static function categories_to_folders() {
		if ( ! taxonomy_exists( NoteFlow_Post_Type::LEGACY_TAXONOMY ) ) {
			NoteFlow_Post_Type::register();
		}

		$terms = get_terms(
			array(
				'taxonomy'   => NoteFlow_Post_Type::LEGACY_TAXONOMY,
				'hide_empty' => true,
			)
		);
		if ( is_wp_error( $terms ) || ! $terms ) {
			return;
		}

		foreach ( $terms as $term ) {
			$posts = get_posts(
				array(
					'post_type'      => NoteFlow_Post_Type::NAME,
					'post_status'    => array( 'publish', 'trash' ),
					'posts_per_page' => -1,
					'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- One-off upgrade.
						array(
							'taxonomy' => NoteFlow_Post_Type::LEGACY_TAXONOMY,
							'terms'    => $term->term_id,
						),
					),
				)
			);

			foreach ( $posts as $post ) {
				$owner  = (int) $post->post_author;
				$folder = null;
				foreach ( NoteFlow_User_State::folders( $owner ) as $existing ) {
					if ( strtolower( $existing['name'] ) === strtolower( $term->name ) ) {
						$folder = $existing;
					}
				}
				if ( ! $folder ) {
					$folder = NoteFlow_User_State::add_folder( $owner, $term->name );
				}
				if ( is_array( $folder ) ) {
					NoteFlow_User_State::file_note( $owner, $post->ID, $folder['id'] );
				}
			}
		}
	}
}
