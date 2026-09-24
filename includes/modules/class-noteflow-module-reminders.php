<?php
/**
 * Reminders module.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * A reminder is a date and time on a note. When it is due, NoteFlow notifies the
 * person who set it, in the app and by email, using WP-Cron.
 */
class NoteFlow_Module_Reminders {

	const HOOK = 'noteflow_reminder';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( self::HOOK, array( __CLASS__, 'fire' ) );
	}

	/**
	 * Sets or clears a note's reminder.
	 *
	 * @param int $note_id Note ID.
	 * @param int $at      Unix timestamp, or 0 to clear.
	 * @param int $user_id Person setting it, who will be reminded.
	 */
	public static function set( $note_id, $at, $user_id ) {
		if ( $at ) {
			update_post_meta( $note_id, NoteFlow_Notes::REMINDER, (int) $at );
			update_post_meta( $note_id, NoteFlow_Notes::REMINDER_BY, (int) $user_id );
			delete_post_meta( $note_id, NoteFlow_Notes::REMINDER_SENT );
		} else {
			delete_post_meta( $note_id, NoteFlow_Notes::REMINDER );
			delete_post_meta( $note_id, NoteFlow_Notes::REMINDER_BY );
			delete_post_meta( $note_id, NoteFlow_Notes::REMINDER_SENT );
		}
		self::schedule( $note_id );
	}

	/**
	 * Schedules the cron event for a note's reminder, if it hasn't gone off yet.
	 *
	 * @param int $note_id Note ID.
	 */
	public static function schedule( $note_id ) {
		$note_id = (int) $note_id;
		wp_clear_scheduled_hook( self::HOOK, array( $note_id ) );

		$at   = (int) get_post_meta( $note_id, NoteFlow_Notes::REMINDER, true );
		$sent = (int) get_post_meta( $note_id, NoteFlow_Notes::REMINDER_SENT, true );
		if ( $at && $sent < $at && 'publish' === get_post_status( $note_id ) ) {
			wp_schedule_single_event( max( $at, time() ), self::HOOK, array( $note_id ) );
		}
	}

	/**
	 * Reschedules every pending reminder, after activation or switching the module on.
	 */
	public static function reschedule_all() {
		global $wpdb;
		$ids = $wpdb->get_col( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare( "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s", NoteFlow_Notes::REMINDER )
		);
		foreach ( $ids as $id ) {
			self::schedule( (int) $id );
		}
	}

	/**
	 * Cron callback: a reminder is due.
	 *
	 * @param int $note_id Note ID.
	 */
	public static function fire( $note_id ) {
		$note_id = (int) $note_id;
		$post    = get_post( $note_id );
		$at      = (int) get_post_meta( $note_id, NoteFlow_Notes::REMINDER, true );

		if ( ! $post || NoteFlow_Notes::POST_TYPE !== $post->post_type || 'publish' !== $post->post_status || ! $at ) {
			return;
		}
		if ( $at > time() + MINUTE_IN_SECONDS ) {
			self::schedule( $note_id );
			return;
		}
		if ( (int) get_post_meta( $note_id, NoteFlow_Notes::REMINDER_SENT, true ) >= $at ) {
			return;
		}

		update_post_meta( $note_id, NoteFlow_Notes::REMINDER_SENT, $at );

		$user_id = (int) get_post_meta( $note_id, NoteFlow_Notes::REMINDER_BY, true );
		if ( ! $user_id || '' === NoteFlow_Access::role( $post, $user_id ) ) {
			$user_id = (int) $post->post_author;
		}
		NoteFlow_Notifications::add( $user_id, 'reminder', $note_id, 0 );
	}
}
