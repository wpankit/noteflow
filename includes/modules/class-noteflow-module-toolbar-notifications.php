<?php
/**
 * Toolbar notifications module.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * A bell in the toolbar, in the admin and on the site, with the number of unread
 * notifications and the latest ones in its menu. It works without JavaScript: each
 * item opens the note and marks the notification as read.
 */
class NoteFlow_Module_Toolbar_Notifications {

	const OPEN_ACTION = 'noteflow_open_notification';
	const READ_ACTION = 'noteflow_read_notifications';
	const SHOW        = 6;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_bar_menu', array( __CLASS__, 'admin_bar' ), 90 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'admin_post_' . self::OPEN_ACTION, array( __CLASS__, 'open' ) );
		add_action( 'admin_post_' . self::READ_ACTION, array( __CLASS__, 'read_all' ) );
	}

	/**
	 * Whether the bell belongs on this request. The notes app has its own.
	 *
	 * @return bool
	 */
	private static function active() {
		if ( ! is_admin_bar_showing() || ! NoteFlow_Access::can_use() ) {
			return false;
		}
		$screen = is_admin() && function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		return ! ( $screen && 'toplevel_page_' . NoteFlow_Admin::PAGE === $screen->id );
	}

	/**
	 * Loads the toolbar styles.
	 */
	public static function enqueue() {
		if ( self::active() ) {
			NoteFlow_Admin_Assets::enqueue_quick();
		}
	}

	/**
	 * Link that opens a notification's note and marks it as read.
	 *
	 * @param array $item Notification.
	 * @return string
	 */
	private static function open_url( $item ) {
		return wp_nonce_url(
			add_query_arg(
				array(
					'action'       => self::OPEN_ACTION,
					'notification' => $item['id'],
					'note'         => (int) $item['note'],
				),
				admin_url( 'admin-post.php' )
			),
			self::OPEN_ACTION . '_' . $item['id']
		);
	}

	/**
	 * Adds the bell and its menu.
	 *
	 * @param WP_Admin_Bar $bar Toolbar.
	 */
	public static function admin_bar( $bar ) {
		if ( ! self::active() ) {
			return;
		}

		$uid    = get_current_user_id();
		$unread = NoteFlow_Notifications::unread_count( $uid );
		$items  = NoteFlow_Notifications::recent( $uid, self::SHOW );
		$app    = admin_url( 'admin.php?page=' . NoteFlow_Admin::PAGE );
		$label  = $unread
			/* translators: %s: number of notifications. */
			? sprintf( _n( '%s unread NoteFlow notification', '%s unread NoteFlow notifications', $unread, 'noteflow' ), number_format_i18n( $unread ) )
			: __( 'NoteFlow notifications', 'noteflow' );

		$bar->add_node(
			array(
				'id'     => 'noteflow-bell',
				'parent' => 'top-secondary',
				'title'  => '<span class="ab-icon" aria-hidden="true"></span>'
					. ( $unread ? '<span class="nf-ab-count" aria-hidden="true">' . esc_html( $unread > 9 ? '9+' : number_format_i18n( $unread ) ) . '</span>' : '' )
					. '<span class="screen-reader-text">' . esc_html( $label ) . '</span>',
				'href'   => $app,
				'meta'   => array(
					'class' => $unread ? 'nf-has-unread' : '',
					'title' => $label,
				),
			)
		);

		if ( ! $items ) {
			$bar->add_node(
				array(
					'id'     => 'noteflow-bell-empty',
					'parent' => 'noteflow-bell',
					'title'  => esc_html__( 'You are all caught up.', 'noteflow' ),
					'meta'   => array( 'class' => 'nf-ab-empty' ),
				)
			);
		}

		foreach ( $items as $item ) {
			$bar->add_node(
				array(
					'id'     => 'noteflow-bell-' . $item['id'],
					'parent' => 'noteflow-bell',
					'title'  => '<span class="nf-ab-text">' . esc_html( NoteFlow_Notifications::describe( $item ) ) . '</span>'
						/* translators: %s: time since, like "5 mins". */
						. '<span class="nf-ab-time">' . esc_html( sprintf( __( '%s ago', 'noteflow' ), human_time_diff( (int) $item['time'] ) ) ) . '</span>',
					'href'   => self::open_url( $item ),
					'meta'   => array( 'class' => empty( $item['read'] ) ? 'nf-ab-unread' : '' ),
				)
			);
		}

		$bar->add_group(
			array(
				'id'     => 'noteflow-bell-actions',
				'parent' => 'noteflow-bell',
				'meta'   => array( 'class' => 'ab-sub-secondary' ),
			)
		);
		if ( $unread ) {
			$bar->add_node(
				array(
					'id'     => 'noteflow-bell-read',
					'parent' => 'noteflow-bell-actions',
					'title'  => esc_html__( 'Mark all as read', 'noteflow' ),
					'href'   => wp_nonce_url( add_query_arg( 'action', self::READ_ACTION, admin_url( 'admin-post.php' ) ), self::READ_ACTION ),
				)
			);
		}
		$bar->add_node(
			array(
				'id'     => 'noteflow-bell-open',
				'parent' => 'noteflow-bell-actions',
				'title'  => esc_html__( 'Open NoteFlow', 'noteflow' ),
				'href'   => $app,
			)
		);
	}

	/**
	 * Opens a notification's note, marking the notification as read.
	 */
	public static function open() {
		$id   = isset( $_GET['notification'] ) ? sanitize_key( wp_unslash( $_GET['notification'] ) ) : '';
		$note = isset( $_GET['note'] ) ? absint( $_GET['note'] ) : 0;
		check_admin_referer( self::OPEN_ACTION . '_' . $id );

		if ( $id && NoteFlow_Access::can_use() ) {
			NoteFlow_Notifications::mark_read( get_current_user_id(), array( $id ) );
		}
		wp_safe_redirect( $note ? NoteFlow_Admin::note_url( $note ) : admin_url( 'admin.php?page=' . NoteFlow_Admin::PAGE ) );
		exit;
	}

	/**
	 * Marks every notification as read and goes back to the page the person was on.
	 */
	public static function read_all() {
		check_admin_referer( self::READ_ACTION );

		if ( NoteFlow_Access::can_use() ) {
			NoteFlow_Notifications::mark_read( get_current_user_id() );
		}
		wp_safe_redirect( wp_get_referer() ? wp_get_referer() : admin_url( 'admin.php?page=' . NoteFlow_Admin::PAGE ) );
		exit;
	}
}
