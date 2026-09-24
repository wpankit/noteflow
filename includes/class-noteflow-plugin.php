<?php
/**
 * Loads NoteFlow and its modules.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Plugin bootstrap.
 */
final class NoteFlow_Plugin {

	/**
	 * The single instance.
	 *
	 * @var NoteFlow_Plugin|null
	 */
	private static $instance = null;

	/**
	 * Returns the single instance, creating it on first use.
	 *
	 * @return NoteFlow_Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Loads the classes and wires up the hooks.
	 */
	private function __construct() {
		self::includes();

		NoteFlow_Post_Type::init();
		NoteFlow_Upgrade::init();
		NoteFlow_Notes::init();
		NoteFlow_REST::init();
		NoteFlow_Settings::init();
		NoteFlow_Admin::init();
		NoteFlow_Review::init();

		foreach ( self::modules() as $module => $class ) {
			if ( NoteFlow_Settings::module_enabled( $module ) ) {
				call_user_func( array( $class, 'init' ) );
			}
		}
	}

	/**
	 * Modules that can be switched on and off in Settings, keyed by their settings name.
	 *
	 * Templates and Import & export are modules too, but they live entirely in the notes app.
	 *
	 * @return array<string,string> Module name => class name.
	 */
	public static function modules() {
		return array(
			'dashboard'     => 'NoteFlow_Module_Dashboard',
			'quick_capture' => 'NoteFlow_Module_Quick_Capture',
			'notifications' => 'NoteFlow_Module_Toolbar_Notifications',
			'reminders'     => 'NoteFlow_Module_Reminders',
			'content_notes' => 'NoteFlow_Module_Content_Notes',
		);
	}

	/**
	 * Requires every class file.
	 */
	private static function includes() {
		$dir = NOTEFLOW_DIR . 'includes/';

		require_once $dir . 'class-noteflow-settings.php';
		require_once $dir . 'class-noteflow-post-type.php';
		require_once $dir . 'class-noteflow-access.php';
		require_once $dir . 'class-noteflow-user-state.php';
		require_once $dir . 'class-noteflow-notes.php';
		require_once $dir . 'class-noteflow-comments.php';
		require_once $dir . 'class-noteflow-notifications.php';
		require_once $dir . 'class-noteflow-rest.php';
		require_once $dir . 'class-noteflow-admin.php';
		require_once $dir . 'class-noteflow-admin-assets.php';
		require_once $dir . 'class-noteflow-upgrade.php';
		require_once $dir . 'class-noteflow-review.php';
		require_once $dir . 'modules/class-noteflow-module-dashboard.php';
		require_once $dir . 'modules/class-noteflow-module-quick-capture.php';
		require_once $dir . 'modules/class-noteflow-module-toolbar-notifications.php';
		require_once $dir . 'modules/class-noteflow-module-reminders.php';
		require_once $dir . 'modules/class-noteflow-module-content-notes.php';
	}

	/**
	 * Activation: register the post type, migrate 1.x data and restore reminders.
	 */
	public static function activate() {
		NoteFlow_Post_Type::register();
		NoteFlow_Upgrade::maybe_upgrade();

		if ( NoteFlow_Settings::module_enabled( 'reminders' ) ) {
			NoteFlow_Module_Reminders::reschedule_all();
		}
	}

	/**
	 * Deactivation: stop pending reminder events. They are rescheduled on activation.
	 */
	public static function deactivate() {
		wp_unschedule_hook( NoteFlow_Module_Reminders::HOOK );
	}
}
