<?php
/**
 * Runs when NoteFlow is deleted from the Plugins screen.
 *
 * Notes are kept unless "Delete all NoteFlow data when the plugin is deleted" is on
 * in NoteFlow → Settings.
 *
 * This file also stops WordPress from calling the uninstall callback that NoteFlow
 * 1.x registered through the Freemius SDK, which 2.0 no longer includes.
 *
 * @package NoteFlow
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Per-person settings NoteFlow keeps, as user options.
 *
 * @return string[]
 */
function noteflow_uninstall_user_keys() {
	return array( 'noteflow_folders', 'noteflow_filed', 'noteflow_pins', 'noteflow_prefs', 'noteflow_notifications', 'noteflow_welcomed', 'noteflow_review', 'noteflow_upgrade_seen' );
}

/**
 * Removes NoteFlow's data from the current site, if the site asked for that.
 *
 * @return bool Whether the data was deleted.
 */
function noteflow_uninstall_site() {
	global $wpdb;

	wp_unschedule_hook( 'noteflow_reminder' );

	$settings = get_option( 'noteflow_settings' );
	if ( empty( $settings['delete_data'] ) ) {
		return false;
	}

	// Notes, with their revisions, meta and comments.
	$ids = $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s", 'noteflow_notes' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	foreach ( $ids as $id ) {
		wp_delete_post( (int) $id, true );
	}

	// Categories from 1.x, if any.
	register_taxonomy( 'noteflow_notes_category', 'noteflow_notes' );
	$terms = get_terms(
		array(
			'taxonomy'   => 'noteflow_notes_category',
			'hide_empty' => false,
			'fields'     => 'ids',
		)
	);
	if ( is_array( $terms ) ) {
		foreach ( $terms as $term_id ) {
			wp_delete_term( (int) $term_id, 'noteflow_notes_category' );
		}
	}

	delete_option( 'noteflow_settings' );
	delete_option( 'noteflow_db_version' );
	delete_option( 'noteflow_legacy_notes' );

	// Each person's folders, pins, preferences and notifications on this site.
	foreach ( noteflow_uninstall_user_keys() as $key ) {
		delete_metadata( 'user', 0, $wpdb->get_blog_prefix() . $key, '', true );
	}

	// Presence lists for open notes.
	$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_noteflow\\_presence\\_%' OR option_name LIKE '\\_transient\\_timeout\\_noteflow\\_presence\\_%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

	return true;
}

$noteflow_deleted = true;
if ( is_multisite() ) {
	foreach ( get_sites(
		array(
			'fields' => 'ids',
			'number' => 1000,
		)
	) as $noteflow_site_id ) {
		switch_to_blog( $noteflow_site_id );
		$noteflow_deleted = noteflow_uninstall_site() && $noteflow_deleted;
		restore_current_blog();
	}
} else {
	$noteflow_deleted = noteflow_uninstall_site();
}

// Keys without a site prefix, from development versions of 2.0, go once every site's data has gone.
if ( $noteflow_deleted ) {
	foreach ( noteflow_uninstall_user_keys() as $noteflow_key ) {
		delete_metadata( 'user', 0, $noteflow_key, '', true );
	}
}
