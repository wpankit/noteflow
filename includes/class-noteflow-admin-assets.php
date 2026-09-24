<?php
/**
 * Assets shared by the Dashboard widget, quick capture and the Notes box.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Loads the small quick-notes script and renders note list items.
 */
class NoteFlow_Admin_Assets {

	/**
	 * Whether the quick script is already enqueued.
	 *
	 * @var bool
	 */
	private static $enqueued = false;

	/**
	 * Enqueues quick.js and quick.css with their data, once.
	 */
	public static function enqueue_quick() {
		if ( self::$enqueued ) {
			return;
		}
		self::$enqueued = true;

		wp_enqueue_style( 'noteflow-quick', NOTEFLOW_URL . 'assets/css/quick.css', array(), NOTEFLOW_VERSION );
		wp_enqueue_script( 'noteflow-quick', NOTEFLOW_URL . 'assets/js/quick.js', array( 'wp-api-fetch', 'wp-i18n' ), NOTEFLOW_VERSION, true );
		wp_set_script_translations( 'noteflow-quick', 'noteflow', NOTEFLOW_DIR . 'languages' );

		$data = array(
			'app'     => admin_url( 'admin.php?page=' . NoteFlow_Admin::PAGE ),
			'capture' => NoteFlow_Settings::module_enabled( 'quick_capture' ) && is_admin_bar_showing(),
			'folders' => NoteFlow_User_State::folders( get_current_user_id() ),
			'link'    => self::current_content(),
		);
		wp_add_inline_script( 'noteflow-quick', 'window.noteflowQuick = ' . wp_json_encode( $data ) . ';', 'before' );
	}

	/**
	 * The post on screen that a quick note could be attached to, if any.
	 *
	 * @return array|null
	 */
	private static function current_content() {
		if ( ! NoteFlow_Settings::module_enabled( 'content_notes' ) ) {
			return null;
		}

		$post = null;
		if ( is_admin() ) {
			$screen = get_current_screen();
			if ( $screen && 'post' === $screen->base ) {
				$post = get_post();
			}
		} elseif ( is_singular() ) {
			$post = get_queried_object();
		}

		if ( ! $post instanceof WP_Post
			|| ! in_array( $post->post_type, (array) NoteFlow_Settings::get( 'content_post_types' ), true )
			|| ! current_user_can( 'edit_post', $post->ID ) ) {
			return null;
		}

		$title = trim( html_entity_decode( $post->post_title, ENT_QUOTES, 'UTF-8' ) );
		return array(
			'id'    => $post->ID,
			'title' => '' === $title ? __( '(no title)', 'noteflow' ) : $title,
		);
	}

	/**
	 * Renders one note as a list item linking into the app.
	 *
	 * @param array $note Note summary.
	 */
	public static function note_item( $note ) {
		if ( $note['reminder'] && ! $note['reminded'] ) {
			/* translators: %s: date and time. */
			$meta = sprintf( _x( 'Reminder: %s', 'reminder date and time', 'noteflow' ), wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $note['reminder'] ) );
		} else {
			/* translators: %s: time since, like "5 mins". */
			$meta = sprintf( __( '%s ago', 'noteflow' ), human_time_diff( $note['modified'] ) );
		}
		?>
		<li>
			<a href="<?php echo esc_url( NoteFlow_Admin::note_url( $note['id'] ) ); ?>">
				<span class="nf-cn-title">
					<?php if ( $note['color'] ) : ?>
						<span class="nf-cn-dot" style="background:<?php echo esc_attr( $note['color'] ); ?>" aria-hidden="true"></span>
					<?php endif; ?>
					<?php echo esc_html( '' === $note['title'] ? __( 'New Note', 'noteflow' ) : $note['title'] ); ?>
				</span>
				<?php if ( '' !== $note['excerpt'] ) : ?>
					<span class="nf-cn-excerpt"><?php echo esc_html( $note['excerpt'] ); ?></span>
				<?php endif; ?>
				<span class="nf-cn-meta"><?php echo esc_html( $meta ); ?></span>
			</a>
		</li>
		<?php
	}
}
