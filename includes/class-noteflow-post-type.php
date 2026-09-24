<?php
/**
 * The note post type.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers notes as a private post type.
 *
 * Notes are only reachable through NoteFlow's REST API, which checks who owns each
 * note and who it is shared with. The post type has no admin screens and uses its
 * own capabilities, which no role has, so core screens can't open notes either.
 */
class NoteFlow_Post_Type {

	const NAME = 'noteflow_notes';

	/**
	 * 1.x registered this taxonomy but never used it. It stays registered, hidden,
	 * so any terms a site created by hand are not orphaned; the upgrade turns them
	 * into folders.
	 */
	const LEGACY_TAXONOMY = 'noteflow_notes_category';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'register' ) );
	}

	/**
	 * Registers the post type and the legacy taxonomy.
	 */
	public static function register() {
		register_post_type(
			self::NAME,
			array(
				'labels'              => array(
					'name'          => __( 'Notes', 'noteflow' ),
					'singular_name' => __( 'Note', 'noteflow' ),
				),
				'public'              => false,
				'publicly_queryable'  => false,
				'exclude_from_search' => true,
				'show_ui'             => false,
				'show_in_menu'        => false,
				'show_in_nav_menus'   => false,
				'show_in_admin_bar'   => false,
				'show_in_rest'        => false,
				'query_var'           => false,
				'rewrite'             => false,
				'can_export'          => true,
				'delete_with_user'    => true,
				'supports'            => array( 'title', 'editor', 'author', 'revisions' ),
				'capability_type'     => array( 'noteflow_note', 'noteflow_notes' ),
				'map_meta_cap'        => true,
			)
		);

		register_taxonomy(
			self::LEGACY_TAXONOMY,
			self::NAME,
			array(
				'public'            => false,
				'show_ui'           => false,
				'show_in_rest'      => false,
				'show_admin_column' => false,
				'query_var'         => false,
				'rewrite'           => false,
				'hierarchical'      => true,
			)
		);
	}
}
