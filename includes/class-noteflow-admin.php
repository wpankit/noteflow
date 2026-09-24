<?php
/**
 * The NoteFlow screen in wp-admin.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds the NoteFlow menu and loads the notes app.
 */
class NoteFlow_Admin {

	/**
	 * Same slug as 1.x, so old bookmarks keep working.
	 */
	const PAGE = 'noteflow-notes';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_filter( 'admin_body_class', array( __CLASS__, 'body_class' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( NOTEFLOW_FILE ), array( __CLASS__, 'action_links' ) );
	}

	/**
	 * Link to a note in the app.
	 *
	 * @param int $note_id Note ID.
	 * @return string
	 */
	public static function note_url( $note_id ) {
		return add_query_arg( 'note', (int) $note_id, admin_url( 'admin.php?page=' . self::PAGE ) );
	}

	/**
	 * The menu icon: a note with a checked circle, drawn in one colour so WordPress
	 * can tint it to match the admin colour scheme.
	 *
	 * @return string Data URI.
	 */
	public static function menu_icon() {
		$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="#a7aaad" fill-rule="evenodd" d="M5.5 2h9A3.5 3.5 0 0 1 18 5.5v9a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 2 14.5v-9A3.5 3.5 0 0 1 5.5 2zm0 1.75A1.75 1.75 0 0 0 3.75 5.5v9c0 .97.78 1.75 1.75 1.75h9c.97 0 1.75-.78 1.75-1.75v-9c0-.97-.78-1.75-1.75-1.75h-9zM7.25 5.6a1.65 1.65 0 1 1 0 3.3 1.65 1.65 0 0 1 0-3.3zm3 .8h4v1.6h-4V6.4zm-3 4.2a1.65 1.65 0 1 1 0 3.3 1.65 1.65 0 0 1 0-3.3zm0 .9a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm3-.1h4v1.6h-4v-1.6z"/></svg>';
		return 'data:image/svg+xml;base64,' . base64_encode( $svg ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- Core expects menu icons as base64 data URIs.
	}

	/**
	 * Adds NoteFlow to the menu for people who can use it, with an unread count.
	 */
	public static function menu() {
		if ( ! NoteFlow_Access::can_use() ) {
			return;
		}

		add_menu_page( __( 'NoteFlow', 'noteflow' ), __( 'NoteFlow', 'noteflow' ), 'read', self::PAGE, array( __CLASS__, 'render' ), self::menu_icon(), 30 );
		add_submenu_page( self::PAGE, __( 'All Notes', 'noteflow' ), __( 'All Notes', 'noteflow' ), 'read', self::PAGE, array( __CLASS__, 'render' ) );

		// The count is added after registering, so it can't change the page's hook name.
		$unread = NoteFlow_Notifications::unread_count( get_current_user_id() );
		if ( $unread ) {
			global $menu;
			foreach ( (array) $menu as $i => $item ) {
				if ( isset( $item[2] ) && self::PAGE === $item[2] ) {
					// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Appending the count bubble, as core does for Comments.
					$menu[ $i ][0] .= sprintf( ' <span class="awaiting-mod count-%1$d"><span class="pending-count">%2$s</span></span>', $unread, esc_html( number_format_i18n( $unread ) ) );
				}
			}
		}
	}

	/**
	 * Whether the current screen is the notes app.
	 *
	 * @return bool
	 */
	private static function is_app_screen() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		return $screen && 'toplevel_page_' . self::PAGE === $screen->id;
	}

	/**
	 * Marks the body so the app can fill the screen.
	 *
	 * @param string $classes Body classes.
	 * @return string
	 */
	public static function body_class( $classes ) {
		return self::is_app_screen() ? $classes . ' noteflow-screen' : $classes;
	}

	/**
	 * Links on the Plugins screen.
	 *
	 * @param string[] $links Links.
	 * @return string[]
	 */
	public static function action_links( $links ) {
		$mine = array(
			'<a href="' . esc_url( admin_url( 'admin.php?page=' . self::PAGE ) ) . '">' . esc_html__( 'Open NoteFlow', 'noteflow' ) . '</a>',
		);
		if ( current_user_can( 'manage_options' ) ) {
			$mine[] = '<a href="' . esc_url( admin_url( 'admin.php?page=' . NoteFlow_Settings::PAGE ) ) . '">' . esc_html__( 'Settings', 'noteflow' ) . '</a>';
		}
		return array_merge( $mine, $links );
	}

	/**
	 * Loads the app's scripts, styles and starting data.
	 *
	 * @param string $hook Current admin page.
	 */
	public static function enqueue( $hook ) {
		if ( 'toplevel_page_' . self::PAGE !== $hook || ! NoteFlow_Access::can_use() ) {
			return;
		}

		wp_enqueue_style( 'noteflow-app', NOTEFLOW_URL . 'assets/css/app.css', array(), NOTEFLOW_VERSION );
		wp_enqueue_script( 'noteflow-editor', NOTEFLOW_URL . 'assets/js/editor.js', array(), NOTEFLOW_VERSION, true );
		wp_enqueue_script( 'noteflow-ui', NOTEFLOW_URL . 'assets/js/ui.js', array( 'wp-i18n' ), NOTEFLOW_VERSION, true );
		wp_enqueue_script( 'noteflow-app', NOTEFLOW_URL . 'assets/js/app.js', array( 'noteflow-editor', 'noteflow-ui', 'wp-api-fetch', 'wp-i18n', 'wp-url' ), NOTEFLOW_VERSION, true );
		wp_set_script_translations( 'noteflow-ui', 'noteflow', NOTEFLOW_DIR . 'languages' );
		wp_set_script_translations( 'noteflow-app', 'noteflow', NOTEFLOW_DIR . 'languages' );

		if ( current_user_can( 'upload_files' ) ) {
			wp_enqueue_media();
		}

		wp_add_inline_script( 'noteflow-app', 'window.noteflowData = ' . wp_json_encode( self::app_data() ) . ';', 'before' );
	}

	/**
	 * Settings and starting data for the app.
	 *
	 * @return array
	 */
	private static function app_data() {
		$uid  = get_current_user_id();
		$user = wp_get_current_user();

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Read-only deep links.
		$note   = isset( $_GET['note'] ) ? absint( $_GET['note'] ) : 0;
		$folder = isset( $_GET['folder'] ) ? sanitize_key( wp_unslash( $_GET['folder'] ) ) : '';
		$new    = ! empty( $_GET['new'] );
		// phpcs:enable

		return array_merge(
			NoteFlow_REST::bootstrap( $uid ),
			array(
				'version'  => NOTEFLOW_VERSION,
				'user'     => array(
					'id'        => $uid,
					'name'      => html_entity_decode( $user->display_name, ENT_QUOTES, 'UTF-8' ),
					'canUpload' => current_user_can( 'upload_files' ),
					'isAdmin'   => current_user_can( 'manage_options' ),
				),
				'settings' => array(
					'sharing'   => NoteFlow_Access::sharing_enabled(),
					'everyone'  => NoteFlow_Access::everyone_enabled(),
					'comments'  => (bool) NoteFlow_Settings::get( 'comments' ),
					'emails'    => (bool) NoteFlow_Settings::get( 'emails' ),
					'modules'   => NoteFlow_Settings::get( 'modules' ),
					'trashDays' => defined( 'EMPTY_TRASH_DAYS' ) ? (int) EMPTY_TRASH_DAYS : 30,
				),
				'start'    => array(
					'note'   => $note,
					'folder' => $folder,
					'new'    => $new,
				),
				'notices'  => array(
					'upgrade' => NoteFlow_Upgrade::show_notice( $uid ),
					'review'  => NoteFlow_Review::should_ask( $uid ),
				),
				'urls'     => array(
					'settings' => current_user_can( 'manage_options' ) ? admin_url( 'admin.php?page=' . NoteFlow_Settings::PAGE ) : '',
					'review'   => NoteFlow_Review::URL,
					'support'  => 'https://wordpress.org/support/plugin/noteflow/',
					'app'      => admin_url( 'admin.php?page=' . self::PAGE ),
					'icon'     => NOTEFLOW_URL . 'assets/images/noteflow-icon.svg',
					'notesApi' => rest_url( NoteFlow_REST::NS . '/notes/' ),
				),
			)
		);
	}

	/**
	 * The app's container. The notes app renders itself into it.
	 */
	public static function render() {
		?>
		<div id="noteflow-root" class="noteflow-root">
			<div class="nf-boot" role="status"><?php esc_html_e( 'Loading NoteFlow…', 'noteflow' ); ?></div>
		</div>
		<noscript><p><?php esc_html_e( 'NoteFlow needs JavaScript. Turn it on in your browser to use your notes.', 'noteflow' ); ?></p></noscript>
		<?php
	}
}
