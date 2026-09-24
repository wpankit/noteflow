<?php
/**
 * Plugin Name:       NoteFlow – Notes, Checklists & Team Collaboration
 * Plugin URI:        https://wordpress.org/plugins/noteflow/
 * Description:       A calm, fast notes app inside WordPress admin. Folders, checklists, tags, reminders, and notes you can share and edit together with your team.
 * Version:           2.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            WPAnkit
 * Author URI:        https://wpankit.com/
 * License:           GPL v2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       noteflow
 * Domain Path:       /languages
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

define( 'NOTEFLOW_VERSION', '2.0.0' );
define( 'NOTEFLOW_FILE', __FILE__ );
define( 'NOTEFLOW_DIR', plugin_dir_path( __FILE__ ) );
define( 'NOTEFLOW_URL', plugin_dir_url( __FILE__ ) );

require_once NOTEFLOW_DIR . 'includes/class-noteflow-plugin.php';

register_activation_hook( __FILE__, array( 'NoteFlow_Plugin', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'NoteFlow_Plugin', 'deactivate' ) );

NoteFlow_Plugin::instance();
