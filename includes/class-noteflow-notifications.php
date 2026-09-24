<?php
/**
 * In-app and email notifications.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Tells people when a note is shared with them, when they are mentioned or a note
 * of theirs gets a comment, and when a reminder is due.
 */
class NoteFlow_Notifications {

	const META  = 'noteflow_notifications';
	const LIMIT = 50;

	/**
	 * A user's notifications, newest first.
	 *
	 * @param int $user_id User ID.
	 * @return array[]
	 */
	public static function all( $user_id ) {
		$items = get_user_option( self::META, $user_id );
		return is_array( $items ) ? array_values( $items ) : array();
	}

	/**
	 * How many notifications the user hasn't seen.
	 *
	 * @param int $user_id User ID.
	 * @return int
	 */
	public static function unread_count( $user_id ) {
		$count = 0;
		foreach ( self::all( $user_id ) as $item ) {
			if ( empty( $item['read'] ) ) {
				++$count;
			}
		}
		return $count;
	}

	/**
	 * Adds a notification, and emails it if emails are on for the site and the person.
	 *
	 * @param int    $user_id  Recipient.
	 * @param string $type     'share', 'mention', 'comment' or 'reminder'.
	 * @param int    $note_id  Note.
	 * @param int    $actor_id Person who did it (0 for reminders).
	 * @param string $text     Comment text or share role.
	 */
	public static function add( $user_id, $type, $note_id, $actor_id, $text = '' ) {
		$user_id = (int) $user_id;
		if ( ! $user_id || $user_id === (int) $actor_id || ! NoteFlow_Access::can_use( $user_id ) ) {
			return;
		}

		$items = self::all( $user_id );
		array_unshift(
			$items,
			array(
				'id'    => strtolower( wp_generate_password( 12, false ) ),
				'type'  => $type,
				'note'  => (int) $note_id,
				'actor' => (int) $actor_id,
				'text'  => function_exists( 'mb_substr' ) ? mb_substr( (string) $text, 0, 300 ) : substr( (string) $text, 0, 300 ),
				'time'  => time(),
				'read'  => false,
			)
		);
		update_user_option( $user_id, self::META, array_slice( $items, 0, self::LIMIT ) );

		self::email( $user_id, $type, $note_id, $actor_id, $text );
	}

	/**
	 * Marks notifications as read.
	 *
	 * @param int      $user_id User ID.
	 * @param string[] $ids     Notification IDs; empty for all.
	 */
	public static function mark_read( $user_id, $ids = array() ) {
		$items = self::all( $user_id );
		foreach ( $items as $i => $item ) {
			if ( ! $ids || in_array( $item['id'], $ids, true ) ) {
				$items[ $i ]['read'] = true;
			}
		}
		update_user_option( $user_id, self::META, $items );
	}

	/**
	 * Notifications for the app, with note titles the user can still see.
	 *
	 * @param int $user_id User ID.
	 * @return array{items:array[],unread:int,people:array}
	 */
	public static function for_app( $user_id ) {
		$items  = array();
		$actors = array();

		foreach ( self::all( $user_id ) as $item ) {
			$note = get_post( (int) $item['note'] );
			$role = $note ? NoteFlow_Access::role( $note, $user_id ) : '';
			if ( '' === $role ) {
				continue;
			}
			$summary       = NoteFlow_Notes::summary( $note, $user_id );
			$item['title'] = $summary['title'];
			$items[]       = $item;
			$actors[]      = (int) $item['actor'];
		}

		return array(
			'items'  => $items,
			'unread' => count(
				array_filter(
					$items,
					function ( $item ) {
						return empty( $item['read'] );
					}
				)
			),
			'people' => NoteFlow_Notes::people( $actors ),
		);
	}

	/**
	 * The latest notifications about notes the user can still open, with note titles.
	 *
	 * @param int $user_id User ID.
	 * @param int $limit   How many.
	 * @return array[]
	 */
	public static function recent( $user_id, $limit ) {
		$items = array();
		foreach ( self::all( $user_id ) as $item ) {
			$note = get_post( (int) $item['note'] );
			if ( ! $note || '' === NoteFlow_Access::role( $note, $user_id ) ) {
				continue;
			}
			$item['title'] = NoteFlow_Notes::summary( $note, $user_id )['title'];
			$items[]       = $item;
			if ( count( $items ) >= $limit ) {
				break;
			}
		}
		return $items;
	}

	/**
	 * A notification as a sentence, like "Maria Chen mentioned you in “Launch plan”".
	 *
	 * @param array $item Notification with a 'title'.
	 * @return string
	 */
	public static function describe( $item ) {
		$actor = ! empty( $item['actor'] ) ? get_userdata( (int) $item['actor'] ) : null;
		$name  = $actor ? html_entity_decode( $actor->display_name, ENT_QUOTES, 'UTF-8' ) : __( 'Someone', 'noteflow' );
		$title = isset( $item['title'] ) && '' !== $item['title'] ? $item['title'] : __( 'New Note', 'noteflow' );

		switch ( $item['type'] ) {
			case 'share':
				/* translators: 1: person's name, 2: note title. */
				return sprintf( __( '%1$s shared “%2$s” with you', 'noteflow' ), $name, $title );
			case 'mention':
				/* translators: 1: person's name, 2: note title. */
				return sprintf( __( '%1$s mentioned you in “%2$s”', 'noteflow' ), $name, $title );
			case 'comment':
				/* translators: 1: person's name, 2: note title. */
				return sprintf( __( '%1$s commented on “%2$s”', 'noteflow' ), $name, $title );
			case 'reminder':
				/* translators: %s: note title. */
				return sprintf( __( 'Reminder: “%s”', 'noteflow' ), $title );
		}
		return $title;
	}

	/**
	 * Sends the email version of a notification.
	 *
	 * @param int    $user_id  Recipient.
	 * @param string $type     Notification type.
	 * @param int    $note_id  Note.
	 * @param int    $actor_id Actor.
	 * @param string $text     Comment text or share role.
	 */
	private static function email( $user_id, $type, $note_id, $actor_id, $text ) {
		if ( ! NoteFlow_Settings::get( 'emails' ) ) {
			return;
		}
		$prefs = NoteFlow_User_State::prefs( $user_id );
		$user  = get_userdata( $user_id );
		$note  = get_post( $note_id );
		if ( empty( $prefs['emails'] ) || ! $user || ! $user->user_email || ! $note ) {
			return;
		}

		$actor = $actor_id ? get_userdata( $actor_id ) : null;
		$name  = $actor ? html_entity_decode( $actor->display_name, ENT_QUOTES, 'UTF-8' ) : __( 'Someone', 'noteflow' );
		$title = NoteFlow_Notes::summary( $note, $user_id )['title'];
		$title = '' === $title ? __( 'New Note', 'noteflow' ) : $title;
		$site  = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
		$link  = NoteFlow_Admin::note_url( $note_id );

		switch ( $type ) {
			case 'share':
				/* translators: 1: person's name, 2: note title. */
				$subject = sprintf( __( '%1$s shared “%2$s” with you', 'noteflow' ), $name, $title );
				$body    = 'edit' === $text
					/* translators: 1: person's name, 2: note title. */
					? sprintf( __( '%1$s shared the note “%2$s” with you. You can view and edit it.', 'noteflow' ), $name, $title )
					/* translators: 1: person's name, 2: note title. */
					: sprintf( __( '%1$s shared the note “%2$s” with you. You can view it and comment.', 'noteflow' ), $name, $title );
				break;
			case 'mention':
				/* translators: 1: person's name, 2: note title. */
				$subject = sprintf( __( '%1$s mentioned you in “%2$s”', 'noteflow' ), $name, $title );
				$body    = $name . ":\n\n" . $text;
				break;
			case 'comment':
				/* translators: 1: person's name, 2: note title. */
				$subject = sprintf( __( '%1$s commented on “%2$s”', 'noteflow' ), $name, $title );
				$body    = $name . ":\n\n" . $text;
				break;
			case 'reminder':
				/* translators: %s: note title. */
				$subject = sprintf( __( 'Reminder: %s', 'noteflow' ), $title );
				/* translators: %s: note title. */
				$body = sprintf( __( 'You asked NoteFlow to remind you about “%s”.', 'noteflow' ), $title );
				break;
			default:
				return;
		}

		$body .= "\n\n" . __( 'Open the note:', 'noteflow' ) . "\n" . $link . "\n\n";
		/* translators: %s: site name. */
		$body .= '— ' . sprintf( __( 'NoteFlow on %s', 'noteflow' ), $site ) . "\n";
		$body .= __( 'You can turn these emails off in NoteFlow, under Preferences.', 'noteflow' );

		$message = array(
			'to'      => $user->user_email,
			'subject' => '[' . $site . '] ' . $subject,
			'body'    => $body,
		);

		/**
		 * Filters a NoteFlow notification email. Return false to skip it.
		 *
		 * @param array|false $message  'to', 'subject' and 'body'.
		 * @param string      $type     Notification type.
		 * @param int         $note_id  Note.
		 * @param int         $user_id  Recipient.
		 * @param int         $actor_id Actor.
		 */
		$message = apply_filters( 'noteflow_notification_email', $message, $type, $note_id, $user_id, $actor_id );
		if ( is_array( $message ) ) {
			wp_mail( $message['to'], $message['subject'], $message['body'] );
		}
	}
}
