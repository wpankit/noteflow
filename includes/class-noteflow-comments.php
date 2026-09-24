<?php
/**
 * Comments on notes.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Comments are stored as note meta rather than WordPress comments, so they never
 * show up in the Comments screen, comment widgets, feeds or the comments REST API.
 */
class NoteFlow_Comments {

	const META       = '_noteflow_comment';
	const MAX_LENGTH = 5000;

	/**
	 * A note's comments, oldest first.
	 *
	 * @param int $note_id Note ID.
	 * @return array[]
	 */
	public static function get( $note_id ) {
		global $wpdb;

		$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				"SELECT meta_id, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s ORDER BY meta_id ASC",
				$note_id,
				self::META
			)
		);

		$comments = array();
		foreach ( $rows as $row ) {
			$comment = maybe_unserialize( $row->meta_value );
			if ( is_array( $comment ) && isset( $comment['user'], $comment['text'], $comment['time'] ) ) {
				$comments[] = self::format( (int) $row->meta_id, $comment );
			}
		}
		return $comments;
	}

	/**
	 * A comment as the app sees it.
	 *
	 * @param int   $id      Comment (meta) ID.
	 * @param array $comment Stored comment.
	 * @return array
	 */
	private static function format( $id, $comment ) {
		return array(
			'id'       => $id,
			'author'   => (int) $comment['user'],
			'text'     => (string) $comment['text'],
			'time'     => (int) $comment['time'],
			'mentions' => array_values( array_map( 'intval', isset( $comment['mentions'] ) ? (array) $comment['mentions'] : array() ) ),
		);
	}

	/**
	 * Adds a comment and lets the right people know.
	 *
	 * @param WP_Post $note     Note.
	 * @param int     $user_id  Author.
	 * @param string  $text     Comment text.
	 * @param int[]   $mentions User IDs the author @mentioned.
	 * @return array|WP_Error The new comment.
	 */
	public static function add( WP_Post $note, $user_id, $text, $mentions ) {
		$text = trim( sanitize_textarea_field( (string) $text ) );
		if ( '' === $text ) {
			return new WP_Error( 'noteflow_comment_empty', __( 'Write something first.', 'noteflow' ), array( 'status' => 400 ) );
		}
		if ( function_exists( 'mb_substr' ) ) {
			$text = mb_substr( $text, 0, self::MAX_LENGTH );
		}

		// Only people who can open the note can be mentioned.
		$mentions = array_values(
			array_filter(
				array_unique( array_map( 'intval', (array) $mentions ) ),
				function ( $uid ) use ( $note, $user_id ) {
					return $uid && $uid !== $user_id && '' !== NoteFlow_Access::role( $note, $uid );
				}
			)
		);

		$comment = array(
			'user'     => (int) $user_id,
			'text'     => $text,
			'time'     => time(),
			'mentions' => $mentions,
		);
		$id      = add_post_meta( $note->ID, self::META, $comment );
		if ( ! $id ) {
			return new WP_Error( 'noteflow_comment_failed', __( 'The comment could not be saved.', 'noteflow' ), array( 'status' => 500 ) );
		}

		foreach ( $mentions as $uid ) {
			NoteFlow_Notifications::add( $uid, 'mention', $note->ID, $user_id, $text );
		}
		$owner = (int) $note->post_author;
		if ( $owner !== $user_id && ! in_array( $owner, $mentions, true ) ) {
			NoteFlow_Notifications::add( $owner, 'comment', $note->ID, $user_id, $text );
		}

		return self::format( (int) $id, $comment );
	}

	/**
	 * Deletes a comment. Its author or the note's owner can do this.
	 *
	 * @param WP_Post $note       Note.
	 * @param int     $comment_id Comment ID.
	 * @param int     $user_id    Person deleting.
	 * @return true|WP_Error
	 */
	public static function delete( WP_Post $note, $comment_id, $user_id ) {
		$meta = get_metadata_by_mid( 'post', (int) $comment_id );
		if ( ! $meta || (int) $meta->post_id !== $note->ID || self::META !== $meta->meta_key ) {
			return new WP_Error( 'noteflow_comment_missing', __( 'That comment no longer exists.', 'noteflow' ), array( 'status' => 404 ) );
		}

		$comment = maybe_unserialize( $meta->meta_value );
		$author  = is_array( $comment ) && isset( $comment['user'] ) ? (int) $comment['user'] : 0;
		if ( $author !== (int) $user_id && (int) $note->post_author !== (int) $user_id ) {
			return new WP_Error( 'noteflow_forbidden', __( 'You can only delete your own comments.', 'noteflow' ), array( 'status' => 403 ) );
		}

		delete_metadata_by_mid( 'post', (int) $comment_id );
		return true;
	}
}
