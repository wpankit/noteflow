<?php
/**
 * Dashboard widget module.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * A Dashboard widget for quick notes, pinned notes and upcoming reminders.
 */
class NoteFlow_Module_Dashboard {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'wp_dashboard_setup', array( __CLASS__, 'register' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
	}

	/**
	 * Adds the widget for people who can use NoteFlow.
	 */
	public static function register() {
		if ( NoteFlow_Access::can_use() ) {
			wp_add_dashboard_widget( 'noteflow_dashboard', __( 'NoteFlow', 'noteflow' ), array( __CLASS__, 'render' ) );
		}
	}

	/**
	 * Loads the widget script on the Dashboard.
	 *
	 * @param string $hook Current admin page.
	 */
	public static function enqueue( $hook ) {
		if ( 'index.php' === $hook && NoteFlow_Access::can_use() ) {
			NoteFlow_Admin_Assets::enqueue_quick();
		}
	}

	/**
	 * Renders the widget.
	 */
	public static function render() {
		$uid     = get_current_user_id();
		$ids     = NoteFlow_Notes::accessible_ids( $uid, false );
		$due     = array();
		$has_any = (bool) $ids;

		if ( NoteFlow_Settings::module_enabled( 'reminders' ) && $ids ) {
			foreach ( NoteFlow_Notes::get_many( $ids ) as $note ) {
				$at   = (int) get_post_meta( $note->ID, NoteFlow_Notes::REMINDER, true );
				$sent = (int) get_post_meta( $note->ID, NoteFlow_Notes::REMINDER_SENT, true );
				if ( $at && $at < time() + WEEK_IN_SECONDS && $sent < $at ) {
					$due[ $at . '-' . $note->ID ] = $note;
				}
			}
			ksort( $due, SORT_NATURAL );
			$due = array_slice( array_values( $due ), 0, 5 );
		}

		// Each note shows once: reminders first, then pins, then the latest of the rest.
		$shown  = wp_list_pluck( $due, 'ID' );
		$pins   = array_values( array_diff( array_intersect( NoteFlow_User_State::pins( $uid ), $ids ), $shown ) );
		$pinned = NoteFlow_Notes::get_many( array_slice( $pins, 0, 5 ) );
		$recent = NoteFlow_Notes::get_many( array_slice( array_values( array_diff( $ids, $pins, $shown ) ), 0, 5 ) );

		$sections = array(
			array( __( 'Reminders', 'noteflow' ), $due, 'nf-dash-due' ),
			array( __( 'Pinned', 'noteflow' ), $pinned, 'nf-dash-pinned' ),
			array( __( 'Recent', 'noteflow' ), $recent, 'nf-dash-recent' ),
		);
		?>
		<div class="nf-dash">
			<div class="nf-dash-quick">
				<label class="screen-reader-text" for="nf-dash-text"><?php esc_html_e( 'Quick note', 'noteflow' ); ?></label>
				<textarea id="nf-dash-text" rows="3" placeholder="<?php esc_attr_e( 'Jot something down…', 'noteflow' ); ?>"></textarea>
				<div class="nf-dash-actions">
					<button type="button" class="button button-primary nf-dash-save"><?php esc_html_e( 'Save note', 'noteflow' ); ?></button>
					<span class="nf-dash-status" role="status"></span>
				</div>
			</div>

			<?php foreach ( $sections as $section ) : ?>
				<?php if ( $section[1] ) : ?>
					<h3 class="nf-dash-heading"><?php echo esc_html( $section[0] ); ?></h3>
					<ul class="nf-cn-list <?php echo esc_attr( $section[2] ); ?>">
						<?php
						foreach ( $section[1] as $note ) {
							NoteFlow_Admin_Assets::note_item( NoteFlow_Notes::summary( $note, $uid ) );
						}
						?>
					</ul>
				<?php endif; ?>
			<?php endforeach; ?>

			<?php if ( ! $has_any ) : ?>
				<p class="nf-dash-empty"><?php esc_html_e( 'Your notes will show up here. Write your first one above.', 'noteflow' ); ?></p>
			<?php endif; ?>

			<p class="nf-dash-footer">
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=' . NoteFlow_Admin::PAGE ) ); ?>"><?php esc_html_e( 'Open NoteFlow', 'noteflow' ); ?> <span aria-hidden="true">&rarr;</span></a>
			</p>
		</div>
		<?php
	}
}
