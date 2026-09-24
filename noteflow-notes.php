<?php
/**
 * Plugin Name:       NoteFlow
 * Plugin URI:        https://pluginstack.dev
 * Description:       A simple notes manager for WordPress admin. Create, organize, and manage your notes directly from the WordPress dashboard.
 * Version:           1.6.0
 * Requires at least: 5.2
 * Requires PHP:      7.2
 * Author:           PluginStackDev
 * Author URI:        https://pluginstack.dev
 * License:          GPL v2 or later
 * License URI:      https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:      noteflow
 *
 * @package          PluginStackDev
 * @author           PluginStackDev
 * @copyright        2025 PluginStackDev
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

class Notefl_Notes {
    private static $instance = null;

    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        $this->define_constants();
        $this->includes();
        $this->init_hooks();
    }

    private function define_constants() {
        define('NOTEFLOW_NOTES_VERSION', '1.6.0');
        define('NOTEFLOW_NOTES_PLUGIN_DIR', plugin_dir_path(__FILE__));
        define('NOTEFLOW_NOTES_PLUGIN_URL', plugin_dir_url(__FILE__));
    }

    private function includes() {
        require_once NOTEFLOW_NOTES_PLUGIN_DIR . 'includes/class-noteflow-notes-post-type.php';
        require_once NOTEFLOW_NOTES_PLUGIN_DIR . 'includes/class-noteflow-notes-admin.php';
    }

    private function init_hooks() {
        add_action('init', array($this, 'init'));
        add_action('admin_enqueue_scripts', array($this, 'admin_scripts'));
    }

    public function init() {
        NoteFlow_Notes_Post_Type::init();
        NoteFlow_Notes_Admin::init();
    }

    public function admin_scripts($hook) {
        if ('toplevel_page_noteflow-notes' !== $hook) {
            return;
        }

        // Enqueue WordPress default editor (TinyMCE)
        wp_enqueue_editor();

        // Enqueue WordPress's built-in TinyMCE scripts
        wp_enqueue_script('editor');
        wp_enqueue_script('quicktags');
        wp_enqueue_script('wp-tinymce');

        // Enqueue jQuery
        wp_enqueue_script('jquery');
        
        // Add media support
        wp_enqueue_media();
        
        // Add color picker
        wp_enqueue_style('wp-color-picker');
        wp_enqueue_script('wp-color-picker');
        
        wp_enqueue_style('wp-notes-admin', 
            NOTEFLOW_NOTES_PLUGIN_URL . 'assets/css/wp-notes-admin.css', 
            array(), 
            NOTEFLOW_NOTES_VERSION
        );
        
        wp_enqueue_script('wp-notes-admin', 
            NOTEFLOW_NOTES_PLUGIN_URL . 'assets/js/wp-notes-admin.js', 
            array('jquery', 'wp-editor'),
            NOTEFLOW_NOTES_VERSION, 
            true
        );

        wp_localize_script('wp-notes-admin', 'wpNotesObj', array(
            'ajaxurl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('wp-notes-nonce')
        ));
    }
}


if ( ! function_exists( 'not_fs' ) ) {
    // Create a helper function for easy SDK access.
    function not_fs() {
        global $not_fs;

        if ( ! isset( $not_fs ) ) {
            // Include Freemius SDK.
            require_once dirname(__FILE__) . '/includes/freemius/start.php';

            $not_fs = fs_dynamic_init( array(
                'id'                  => '17851',
                'slug'                => 'noteflow',
                'type'                => 'plugin',
                'public_key'          => 'pk_8c92db78345914f9b53e7e93b4dff',
                'is_premium'          => false,
                'has_addons'          => false,
                'has_paid_plans'      => false,
                'menu'                => array(
                    'slug'           => 'noteflow-notes',
                    'first-path'     => 'admin.php?page=noteflow-notes',
                    'account'        => false,
                ),
            ) );
        }

        return $not_fs;
    }

    // Init Freemius.
    not_fs();
    // Signal that SDK was initiated.
    do_action( 'not_fs_loaded' );

    Notefl_notes();
}

// Initialize the plugin
function Notefl_notes() {
    return Notefl_Notes::get_instance();
}


/* Show a small promotional notice for PluginStack bundle. */
add_action( 'admin_notices', 'noteflow_pluginstack_promo_notice' );
function noteflow_pluginstack_promo_notice() {
	$dismissed = get_option( 'noteflow_pluginstack_promo_dismissed' );
	if ( $dismissed ) {
		return;
	}
	?>
	<div class="notice noteflow-promo-notice" style="border-left-color:#6c47ff;padding:8px 12px;display:flex;align-items:center;gap:10px;">
		<span style="font-size:18px;">⚡</span>
		<p style="margin:0;font-size:13px;">
			<strong>Enjoying this plugin?</strong> Get the <a href="https://pluginstack.dev/?utm_source=noteflow&utm_medium=admin_notice&utm_campaign=pluginstack_bundle" target="_blank" rel="noopener noreferrer" style="color:#6c47ff;font-weight:600;">PluginStack Bundle</a> — AI, WooCommerce, Gravity Forms, Analytics &amp; more. All current + upcoming plugins. <strong>One-time payment, no subscription.</strong>
			<a href="<?php echo esc_url( wp_nonce_url( add_query_arg( 'noteflow_dismiss_promo', '1' ), 'noteflow_dismiss_promo' ) ); ?>" style="margin-left:10px;color:#999;font-size:12px;text-decoration:none;"><?php esc_html_e( 'Dismiss', 'noteflow' ); ?></a>
		</p>
	</div>
	<?php
}

/* Handle dismiss action for PluginStack promo notice. */
add_action( 'admin_init', 'noteflow_handle_promo_dismiss' );
function noteflow_handle_promo_dismiss() {
	if ( isset( $_GET['noteflow_dismiss_promo'] ) && check_admin_referer( 'noteflow_dismiss_promo' ) ) {
		update_option( 'noteflow_pluginstack_promo_dismissed', true );
		wp_safe_redirect( remove_query_arg( array( 'noteflow_dismiss_promo', '_wpnonce' ) ) );
		exit;
	}
}