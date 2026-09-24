<?php
/**
 * Quick capture module.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * A Note button in the toolbar, in the admin and on the site, that opens a small
 * form for saving an idea without leaving the page. Alt + Shift + N opens it too.
 */
class NoteFlow_Module_Quick_Capture {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_bar_menu', array( __CLASS__, 'admin_bar' ), 75 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
	}

	/**
	 * Whether quick capture should appear on this request.
	 *
	 * @return bool
	 */
	private static function active() {
		if ( ! is_admin_bar_showing() || ! NoteFlow_Access::can_use() ) {
			return false;
		}
		// The notes app has its own compose button.
		$screen = is_admin() && function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		return ! ( $screen && 'toplevel_page_' . NoteFlow_Admin::PAGE === $screen->id );
	}

	/**
	 * Adds the Note button to the toolbar.
	 *
	 * @param WP_Admin_Bar $bar Toolbar.
	 */
	public static function admin_bar( $bar ) {
		if ( ! self::active() ) {
			return;
		}
		$bar->add_node(
			array(
				'id'    => 'noteflow-quick',
				'title' => '<span class="ab-icon" aria-hidden="true"></span><span class="ab-label">' . esc_html__( 'Note', 'noteflow' ) . '</span>',
				'href'  => add_query_arg( 'new', 1, admin_url( 'admin.php?page=' . NoteFlow_Admin::PAGE ) ),
				'meta'  => array(
					'title' => __( 'Quick note (Alt+Shift+N)', 'noteflow' ),
				),
			)
		);
	}

	/**
	 * Loads the quick capture script wherever the toolbar shows.
	 */
	public static function enqueue() {
		if ( self::active() ) {
			NoteFlow_Admin_Assets::enqueue_quick( true );
		}
	}
}
