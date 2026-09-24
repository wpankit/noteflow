<?php
/**
 * Site-wide settings and the Settings screen.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Stores the settings in one option and renders NoteFlow → Settings.
 */
class NoteFlow_Settings {

	const OPTION = 'noteflow_settings';
	const PAGE   = 'noteflow-settings';

	/**
	 * Settings for this request, merged with the defaults.
	 *
	 * @var array|null
	 */
	private static $cache = null;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		add_action( 'admin_menu', array( __CLASS__, 'menu' ), 20 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'update_option_' . self::OPTION, array( __CLASS__, 'updated' ), 10, 2 );
	}

	/**
	 * Default settings. New installs and 1.x upgrades start from these.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'roles'              => array( 'administrator', 'editor', 'author', 'contributor' ),
			'sharing'            => true,
			'share_everyone'     => true,
			'comments'           => true,
			'emails'             => true,
			'modules'            => array(
				'dashboard'     => true,
				'quick_capture' => true,
				'notifications' => true,
				'reminders'     => true,
				'content_notes' => true,
				'templates'     => true,
				'export'        => true,
			),
			'content_post_types' => array( 'post', 'page' ),
			'delete_data'        => false,
		);
	}

	/**
	 * All settings, merged with the defaults.
	 *
	 * @return array
	 */
	public static function all() {
		if ( null === self::$cache ) {
			$saved    = get_option( self::OPTION, array() );
			$saved    = is_array( $saved ) ? $saved : array();
			$defaults = self::defaults();

			$settings            = array_merge( $defaults, $saved );
			$settings['modules'] = array_merge( $defaults['modules'], isset( $saved['modules'] ) && is_array( $saved['modules'] ) ? $saved['modules'] : array() );

			self::$cache = $settings;
		}
		return self::$cache;
	}

	/**
	 * One setting.
	 *
	 * @param string $key Setting name.
	 * @return mixed
	 */
	public static function get( $key ) {
		$settings = self::all();
		return isset( $settings[ $key ] ) ? $settings[ $key ] : null;
	}

	/**
	 * Whether a module is switched on.
	 *
	 * @param string $module Module name.
	 * @return bool
	 */
	public static function module_enabled( $module ) {
		$modules = self::get( 'modules' );
		return ! empty( $modules[ $module ] );
	}

	/**
	 * Modules shown on the Settings screen.
	 *
	 * @return array
	 */
	public static function module_info() {
		return array(
			'dashboard'     => array(
				'title'       => __( 'Dashboard widget', 'noteflow' ),
				'description' => __( 'Jot down a quick note and see pinned notes and upcoming reminders on the Dashboard.', 'noteflow' ),
				'icon'        => 'dashicons-dashboard',
			),
			'quick_capture' => array(
				'title'       => __( 'Quick capture', 'noteflow' ),
				'description' => __( 'A Note button in the toolbar, in the admin and on your site, to save an idea in seconds. Shortcut: Alt + Shift + N.', 'noteflow' ),
				'icon'        => 'dashicons-edit',
			),
			'notifications' => array(
				'title'       => __( 'Toolbar notifications', 'noteflow' ),
				'description' => __( 'A bell in the toolbar shows new shares, mentions and due reminders on every screen, with the latest ones a click away.', 'noteflow' ),
				'icon'        => 'dashicons-bell',
			),
			'reminders'     => array(
				'title'       => __( 'Reminders', 'noteflow' ),
				'description' => __( 'Set a date and time on any note. NoteFlow lets you know in the app, and by email, when it is due.', 'noteflow' ),
				'icon'        => 'dashicons-clock',
			),
			'content_notes' => array(
				'title'       => __( 'Content notes', 'noteflow' ),
				'description' => __( 'Attach notes to posts and pages. They appear in a Notes box in the editor, so feedback stays next to the content.', 'noteflow' ),
				'icon'        => 'dashicons-admin-page',
			),
			'templates'     => array(
				'title'       => __( 'Templates', 'noteflow' ),
				'description' => __( 'Start notes from ready-made templates: meeting notes, content brief, bug report, launch checklist and more.', 'noteflow' ),
				'icon'        => 'dashicons-layout',
			),
			'export'        => array(
				'title'       => __( 'Import & export', 'noteflow' ),
				'description' => __( 'Download notes as Markdown or HTML, print them, and move all your notes between sites with a backup file.', 'noteflow' ),
				'icon'        => 'dashicons-download',
			),
		);
	}

	/**
	 * Registers the option with its sanitizer.
	 */
	public static function register() {
		register_setting(
			self::OPTION,
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'default'           => self::defaults(),
				'show_in_rest'      => false,
			)
		);
	}

	/**
	 * Cleans submitted settings. Unchecked boxes are simply missing from the form.
	 *
	 * @param mixed $input Raw value.
	 * @return array
	 */
	public static function sanitize( $input ) {
		$input    = is_array( $input ) ? $input : array();
		$defaults = self::defaults();
		$clean    = array();

		$roles          = isset( $input['roles'] ) ? array_map( 'sanitize_key', (array) $input['roles'] ) : array();
		$roles          = array_values( array_intersect( $roles, array_keys( wp_roles()->get_names() ) ) );
		$clean['roles'] = array_values( array_unique( array_merge( array( 'administrator' ), $roles ) ) );

		foreach ( array( 'sharing', 'share_everyone', 'comments', 'emails', 'delete_data' ) as $key ) {
			$clean[ $key ] = ! empty( $input[ $key ] );
		}

		$clean['modules'] = array();
		foreach ( array_keys( $defaults['modules'] ) as $module ) {
			$clean['modules'][ $module ] = ! empty( $input['modules'][ $module ] );
		}

		$types                       = isset( $input['content_post_types'] ) ? array_map( 'sanitize_key', (array) $input['content_post_types'] ) : array();
		$clean['content_post_types'] = array_values( array_intersect( $types, array_keys( self::content_post_types() ) ) );

		self::$cache = null;
		return $clean;
	}

	/**
	 * Post types that can carry content notes: every type with an editing screen.
	 *
	 * @return array<string,string> Name => label.
	 */
	public static function content_post_types() {
		$types = array();
		foreach ( get_post_types( array( 'show_ui' => true ), 'objects' ) as $type ) {
			if ( in_array( $type->name, array( 'attachment', 'wp_block', 'wp_navigation', 'wp_template', 'wp_template_part' ), true ) ) {
				continue;
			}
			$types[ $type->name ] = $type->labels->singular_name;
		}
		return $types;
	}

	/**
	 * Keeps scheduled reminders in step with the Reminders module.
	 *
	 * @param mixed $old_value Previous settings.
	 * @param mixed $value     New settings.
	 */
	public static function updated( $old_value, $value ) {
		self::$cache = null;

		$was = ! empty( $old_value['modules']['reminders'] );
		$is  = ! empty( $value['modules']['reminders'] );

		if ( $was && ! $is ) {
			wp_unschedule_hook( NoteFlow_Module_Reminders::HOOK );
		} elseif ( ! $was && $is ) {
			NoteFlow_Module_Reminders::reschedule_all();
		}
	}

	/**
	 * Adds NoteFlow → Settings for administrators.
	 */
	public static function menu() {
		add_submenu_page(
			NoteFlow_Admin::PAGE,
			__( 'NoteFlow Settings', 'noteflow' ),
			__( 'Settings', 'noteflow' ),
			'manage_options',
			self::PAGE,
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * Styles for the Settings screen.
	 *
	 * @param string $hook Current admin page.
	 */
	public static function enqueue( $hook ) {
		if ( 'noteflow_page_' . self::PAGE !== $hook ) {
			return;
		}
		wp_enqueue_style( 'noteflow-settings', NOTEFLOW_URL . 'assets/css/settings.css', array(), NOTEFLOW_VERSION );
	}

	/**
	 * Renders a switch.
	 *
	 * @param string $name        Field name.
	 * @param bool   $checked     Current state.
	 * @param string $title       Label.
	 * @param string $description Help text.
	 */
	private static function toggle( $name, $checked, $title, $description ) {
		?>
		<label class="nf-toggle">
			<input type="checkbox" name="<?php echo esc_attr( $name ); ?>" value="1" <?php checked( $checked ); ?>>
			<span class="nf-toggle-track" aria-hidden="true"></span>
			<span class="nf-toggle-text">
				<strong><?php echo esc_html( $title ); ?></strong>
				<span><?php echo esc_html( $description ); ?></span>
			</span>
		</label>
		<?php
	}

	/**
	 * Renders NoteFlow → Settings.
	 */
	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings = self::all();
		$opt      = self::OPTION;
		$counts   = wp_count_posts( NoteFlow_Notes::POST_TYPE );
		$notes    = isset( $counts->publish ) ? (int) $counts->publish : 0;
		?>
		<div class="wrap nf-settings">
			<header class="nf-settings-header">
				<img src="<?php echo esc_url( NOTEFLOW_URL . 'assets/images/noteflow-icon.svg' ); ?>" width="48" height="48" alt="">
				<div>
					<h1><?php esc_html_e( 'NoteFlow Settings', 'noteflow' ); ?></h1>
					<p>
						<?php
						/* translators: %s: plugin version. */
						echo esc_html( sprintf( __( 'Version %s', 'noteflow' ), NOTEFLOW_VERSION ) );
						echo ' &middot; ';
						/* translators: %s: number of notes. */
						echo esc_html( sprintf( _n( '%s note on this site', '%s notes on this site', $notes, 'noteflow' ), number_format_i18n( $notes ) ) );
						?>
					</p>
				</div>
				<a class="button button-primary nf-open-app" href="<?php echo esc_url( admin_url( 'admin.php?page=' . NoteFlow_Admin::PAGE ) ); ?>"><?php esc_html_e( 'Open NoteFlow', 'noteflow' ); ?></a>
			</header>

			<?php settings_errors( $opt ); ?>

			<div class="nf-settings-layout">
				<form method="post" action="options.php" class="nf-settings-main">
					<?php settings_fields( $opt ); ?>

					<section class="nf-card">
						<h2><?php esc_html_e( 'Who can use NoteFlow', 'noteflow' ); ?></h2>
						<p class="nf-card-intro"><?php esc_html_e( 'Everyone in these roles gets their own notes, which stay private until they share them. Administrators always have access.', 'noteflow' ); ?></p>
						<div class="nf-roles">
							<?php foreach ( wp_roles()->get_names() as $role => $label ) : ?>
								<label class="nf-role">
									<input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[roles][]" value="<?php echo esc_attr( $role ); ?>" <?php checked( in_array( $role, (array) $settings['roles'], true ) || 'administrator' === $role ); ?> <?php disabled( 'administrator', $role ); ?>>
									<?php echo esc_html( translate_user_role( $label ) ); ?>
								</label>
							<?php endforeach; ?>
						</div>
					</section>

					<section class="nf-card">
						<h2><?php esc_html_e( 'Collaboration', 'noteflow' ); ?></h2>
						<p class="nf-card-intro"><?php esc_html_e( 'People can invite others to view or edit a note. Everyone sees who else is in the note, and changes sync on their own.', 'noteflow' ); ?></p>
						<div class="nf-toggles">
							<?php
							self::toggle( $opt . '[sharing]', $settings['sharing'], __( 'Sharing', 'noteflow' ), __( 'Let people share their notes with other NoteFlow users as viewers or editors.', 'noteflow' ) );
							self::toggle( $opt . '[share_everyone]', $settings['share_everyone'], __( 'Share with everyone', 'noteflow' ), __( 'Allow a note to be shared with everyone who can use NoteFlow, in one step.', 'noteflow' ) );
							self::toggle( $opt . '[comments]', $settings['comments'], __( 'Comments and mentions', 'noteflow' ), __( 'Discuss a note in its activity panel, and @mention people to let them know.', 'noteflow' ) );
							self::toggle( $opt . '[emails]', $settings['emails'], __( 'Email notifications', 'noteflow' ), __( 'Email people when a note is shared with them, when someone mentions them, and when a reminder is due. Each person can turn these off in NoteFlow.', 'noteflow' ) );
							?>
						</div>
					</section>

					<section class="nf-card">
						<h2><?php esc_html_e( 'Modules', 'noteflow' ); ?></h2>
						<p class="nf-card-intro"><?php esc_html_e( 'Switch off anything your team does not need. Nothing is deleted when a module is off.', 'noteflow' ); ?></p>
						<div class="nf-modules">
							<?php foreach ( self::module_info() as $module => $info ) : ?>
								<div class="nf-module">
									<span class="nf-module-icon dashicons <?php echo esc_attr( $info['icon'] ); ?>" aria-hidden="true"></span>
									<?php self::toggle( $opt . '[modules][' . $module . ']', ! empty( $settings['modules'][ $module ] ), $info['title'], $info['description'] ); ?>
									<?php if ( 'content_notes' === $module ) : ?>
										<fieldset class="nf-module-extra">
											<legend><?php esc_html_e( 'Show the Notes box on', 'noteflow' ); ?></legend>
											<?php foreach ( self::content_post_types() as $type => $label ) : ?>
												<label>
													<input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[content_post_types][]" value="<?php echo esc_attr( $type ); ?>" <?php checked( in_array( $type, (array) $settings['content_post_types'], true ) ); ?>>
													<?php echo esc_html( $label ); ?>
												</label>
											<?php endforeach; ?>
										</fieldset>
									<?php endif; ?>
								</div>
							<?php endforeach; ?>
						</div>
					</section>

					<section class="nf-card">
						<h2><?php esc_html_e( 'Data', 'noteflow' ); ?></h2>
						<div class="nf-toggles">
							<?php self::toggle( $opt . '[delete_data]', $settings['delete_data'], __( 'Delete all NoteFlow data when the plugin is deleted', 'noteflow' ), __( 'Removes every note, folder, comment and setting when you delete NoteFlow from the Plugins screen. This cannot be undone. Deactivating keeps everything.', 'noteflow' ) ); ?>
						</div>
					</section>

					<?php submit_button( __( 'Save Settings', 'noteflow' ) ); ?>
				</form>

				<aside class="nf-settings-side">
					<?php self::render_sidebar(); ?>
				</aside>
			</div>
		</div>
		<?php
	}

	/**
	 * The sidebar: a review request and our other plugins.
	 *
	 * Links carry no tracking parameters and every image is bundled with the plugin
	 * (WordPress.org plugin guidelines 7 and 11).
	 */
	private static function render_sidebar() {
		$featured = array(
			array(
				'name'        => 'Page Visit Counter',
				'tagline'     => __( 'Privacy-first analytics inside WordPress', 'noteflow' ),
				'description' => __( 'See visitors and page views right in your dashboard, with no cookies and no external scripts.', 'noteflow' ),
				'url'         => 'https://pagevisitcounter.com/',
				'icon'        => 'page-visit-counter-icon.svg',
			),
			array(
				'name'        => 'PushRow for Google Sheets',
				'tagline'     => __( 'Keep Google Sheets in sync with WordPress', 'noteflow' ),
				'description' => __( 'Send posts, users, form entries and WooCommerce orders to any spreadsheet.', 'noteflow' ),
				'url'         => 'https://getpushrow.com/',
				'icon'        => 'pushrow-icon.svg',
			),
		);
		$more     = array(
			array(
				'name'    => 'UltimaKit',
				'tagline' => __( 'Admin tools, security and performance in one plugin', 'noteflow' ),
				'url'     => 'https://wordpress.org/plugins/ultimakit-for-wp/',
				'icon'    => 'ultimakit-icon.png',
			),
			array(
				'name'    => 'Hide Admin Bar Based on User Roles',
				'tagline' => __( 'Hide the toolbar for the roles you choose', 'noteflow' ),
				'url'     => 'https://wordpress.org/plugins/hide-admin-bar-based-on-user-roles/',
				'icon'    => 'hab-icon.svg',
			),
		);
		$images   = NOTEFLOW_URL . 'assets/images/plugins/';
		?>
		<div class="nf-card nf-review">
			<h2><?php esc_html_e( 'NoteFlow is free, for good', 'noteflow' ); ?></h2>
			<p><?php esc_html_e( 'No upsells, no locked features. If NoteFlow helps your team, a short review on WordPress.org helps other people find it.', 'noteflow' ); ?></p>
			<a class="button" href="https://wordpress.org/support/plugin/noteflow/reviews/#new-post" target="_blank" rel="noopener noreferrer">
				<span class="nf-stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
				<?php esc_html_e( 'Leave a review', 'noteflow' ); ?>
				<span class="screen-reader-text"><?php esc_html_e( '(opens in a new tab)', 'noteflow' ); ?></span>
			</a>
			<p class="nf-support">
				<a href="https://wordpress.org/support/plugin/noteflow/" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Get help or suggest a feature', 'noteflow' ); ?><span class="screen-reader-text"><?php esc_html_e( '(opens in a new tab)', 'noteflow' ); ?></span></a>
			</p>
		</div>

		<div class="nf-card nf-promo">
			<h2><?php esc_html_e( 'More from the makers of NoteFlow', 'noteflow' ); ?></h2>
			<?php foreach ( $featured as $plugin ) : ?>
				<a class="nf-promo-featured" href="<?php echo esc_url( $plugin['url'] ); ?>" target="_blank" rel="noopener noreferrer">
					<span class="nf-promo-head">
						<img src="<?php echo esc_url( $images . $plugin['icon'] ); ?>" width="40" height="40" alt="">
						<span>
							<span class="nf-promo-name"><?php echo esc_html( $plugin['name'] ); ?></span>
							<span class="nf-promo-tagline"><?php echo esc_html( $plugin['tagline'] ); ?></span>
						</span>
					</span>
					<span class="nf-promo-description"><?php echo esc_html( $plugin['description'] ); ?></span>
					<span class="nf-promo-cta"><?php esc_html_e( 'Learn more', 'noteflow' ); ?> <span aria-hidden="true">&rarr;</span><span class="screen-reader-text"><?php esc_html_e( '(opens in a new tab)', 'noteflow' ); ?></span></span>
				</a>
			<?php endforeach; ?>

			<h3><?php esc_html_e( 'More free plugins on WordPress.org', 'noteflow' ); ?></h3>
			<ul class="nf-promo-list">
				<?php foreach ( $more as $plugin ) : ?>
					<li>
						<a href="<?php echo esc_url( $plugin['url'] ); ?>" target="_blank" rel="noopener noreferrer">
							<img src="<?php echo esc_url( $images . $plugin['icon'] ); ?>" width="32" height="32" alt="">
							<span>
								<span class="nf-promo-name"><?php echo esc_html( $plugin['name'] ); ?></span>
								<span class="nf-promo-tagline"><?php echo esc_html( $plugin['tagline'] ); ?></span>
								<span class="screen-reader-text"><?php esc_html_e( '(opens in a new tab)', 'noteflow' ); ?></span>
							</span>
						</a>
					</li>
				<?php endforeach; ?>
			</ul>
		</div>
		<?php
	}
}
