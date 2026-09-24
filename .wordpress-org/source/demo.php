<?php
/**
 * Demo workspace for NoteFlow screenshots. Run with: wp eval-file demo.php
 */
$priya = get_user_by( 'login', 'priya' );
if ( ! $priya ) {
	$uid   = wp_insert_user( array( 'user_login' => 'priya', 'user_email' => 'priya@example.test', 'user_pass' => wp_generate_password( 24 ), 'display_name' => 'Priya Sharma', 'first_name' => 'Priya', 'last_name' => 'Sharma', 'role' => 'editor' ) );
	$priya = get_user_by( 'id', $uid );
}
$P = $priya->ID;
$M = get_user_by( 'login', 'maria' )->ID;
$R = get_user_by( 'login', 'rahul' )->ID;
$S = get_user_by( 'login', 'sofia' )->ID;

// Admin menu folded and no welcome panel for Priya.
update_user_meta( $P, 'wp_user-settings', 'mfold=f' );
update_user_meta( $P, 'wp_user-settings-time', time() );
update_user_meta( $P, 'show_welcome_panel', 0 );
update_user_meta( $P, 'meta-box-order_dashboard', array( 'normal' => 'noteflow_dashboard,dashboard_activity', 'side' => 'dashboard_site_health,dashboard_right_now,dashboard_quick_press', 'column3' => '', 'column4' => '' ) );

// Remove what an earlier run created.
$previous = get_option( 'noteflow_demo_ids', array() );
foreach ( (array) $previous as $id ) {
	wp_delete_post( (int) $id, true );
}

// Start clean for Priya.
foreach ( get_posts( array( 'post_type' => 'noteflow_notes', 'post_status' => 'any', 'author__in' => array( $P ), 'posts_per_page' => -1, 'fields' => 'ids' ) ) as $id ) {
	wp_delete_post( $id, true );
}
foreach ( array( 'noteflow_folders', 'noteflow_filed', 'noteflow_pins', 'noteflow_notifications', 'noteflow_prefs' ) as $k ) {
	delete_user_option( $P, $k );
	delete_user_meta( $P, $k );
}
update_user_option( $P, 'noteflow_welcomed', time() - 40 * DAY_IN_SECONDS );
update_user_option( $P, 'noteflow_review', 'done' );
update_user_option( $P, 'noteflow_upgrade_seen', NOTEFLOW_VERSION );

$folders = array();
foreach ( array( 'Clients', 'Content', 'Meetings', 'Ideas' ) as $name ) {
	$f                 = NoteFlow_User_State::add_folder( $P, $name );
	$folders[ $name ] = $f['id'];
}

/** Creates a note as someone, then back-dates it. */
function nf_demo_note( $owner, $title, $content, $args, $days_ago, $hour ) {
	wp_set_current_user( $owner );
	$post = NoteFlow_Notes::create( $owner, array_merge( array( 'title' => $title, 'content' => $content ), $args ) );
	nf_demo_date( $post->ID, $days_ago, $hour );
	return $post->ID;
}

/** Sets created and modified dates, days ago at a local hour. */
function nf_demo_date( $id, $days_ago, $hour, $created_too = true ) {
	global $wpdb;
	$ts    = strtotime( 'today' ) - $days_ago * DAY_IN_SECONDS + (int) ( $hour * HOUR_IN_SECONDS );
	$local = wp_date( 'Y-m-d H:i:s', $ts );
	$gmt   = gmdate( 'Y-m-d H:i:s', $ts );
	$data  = array( 'post_modified' => $local, 'post_modified_gmt' => $gmt );
	if ( $created_too ) {
		$data['post_date']     = $local;
		$data['post_date_gmt'] = $gmt;
	}
	$wpdb->update( $wpdb->posts, $data, array( 'ID' => $id ) );
	clean_post_cache( $id );
}

/** Saves new content as someone, like the app does. */
function nf_demo_edit( $id, $user, $content, $title = null ) {
	wp_set_current_user( $user );
	$post   = get_post( $id );
	$fields = array( 'content' => NoteFlow_Notes::sanitize_content( $content ) );
	if ( null !== $title ) {
		$fields['title'] = $title;
	}
	return NoteFlow_Notes::update_content( $post, $user, $fields, NoteFlow_Notes::version( $post ), true );
}

/** Back-dates a note's revisions, oldest first, spread before its last change. */
function nf_demo_revision_dates( $id, $offsets_minutes ) {
	global $wpdb;
	$revs = array_reverse( wp_get_post_revisions( $id, array( 'posts_per_page' => 20 ) ) );
	$base = strtotime( get_post( $id )->post_modified_gmt . ' +0000' );
	foreach ( $revs as $i => $rev ) {
		$ts = $base - ( $offsets_minutes[ $i ] ?? 0 ) * MINUTE_IN_SECONDS;
		$wpdb->update( $wpdb->posts, array( 'post_date' => wp_date( 'Y-m-d H:i:s', $ts ), 'post_date_gmt' => gmdate( 'Y-m-d H:i:s', $ts ) ), array( 'ID' => $rev->ID ) );
		clean_post_cache( $rev->ID );
	}
}

$launch_v1 = '<p>Everything we need before the Northwind site goes live on Friday. #launch</p><h2>Before launch</h2><ul class="nf-checklist"><li class="nf-checked">Final copy approved by the client</li><li>Set up 301 redirects from the old URLs</li><li>Compress hero images</li><li>Test forms and email delivery</li><li>Check the site on phones and tablets</li><li>Add Open Graph images</li><li>Take a final backup of the old site</li></ul><h2>Launch day</h2><ol><li>Point the domain to the new host</li><li>Clear all caches</li><li>Submit the sitemap in Search Console</li></ol>';
$launch_v2 = str_replace( array( '<li>Set up 301 redirects from the old URLs</li>', '<li>Compress hero images</li>' ), array( '<li class="nf-checked">Set up 301 redirects from the old URLs</li>', '<li class="nf-checked">Compress hero images</li>' ), $launch_v1 );
$launch_v3 = str_replace( '<li>Test forms and email delivery</li>', '<li class="nf-checked">Test forms and email delivery</li>', $launch_v2 ) . '<blockquote>Anna from Northwind would like to go live before 11 am their time.</blockquote>';

$launch = nf_demo_note( $P, 'Website relaunch', $launch_v1, array( 'folder' => $folders['Clients'] ), 0, 9.25 );
NoteFlow_Access::set_share( $launch, '', array( $M => 'edit', $R => 'edit' ) );
nf_demo_edit( $launch, $R, $launch_v2 );
nf_demo_edit( $launch, $M, $launch_v3 );
nf_demo_date( $launch, 0, 11.6, false );
nf_demo_revision_dates( $launch, array( 150, 95, 38, 0 ) );
NoteFlow_User_State::set_pin( $P, $launch, true );
update_post_meta( $launch, NoteFlow_Notes::REMINDER, strtotime( 'tomorrow 10:00' ) );
update_post_meta( $launch, NoteFlow_Notes::REMINDER_BY, $P );
foreach ( array(
	array( $R, 'Redirects are in and the old sitemap is mapped. I will run a crawl on staging tonight.', array(), 120 ),
	array( $M, 'Forms send fine now. @Priya Sharma can you check the site on your phone before Thursday?', array( $P ), 42 ),
	array( $P, 'Will do this afternoon. Thanks both!', array(), 18 ),
) as $c ) {
	add_post_meta( $launch, NoteFlow_Comments::META, array( 'user' => $c[0], 'text' => $c[1], 'time' => time() - $c[3] * MINUTE_IN_SECONDS, 'mentions' => $c[2] ) );
}

$calendar = nf_demo_note( $P, 'October content calendar', '<p>Four posts, one a week. Drafts are due the Friday before. #content</p><table class="nf-table"><tbody><tr><td><strong>Week</strong></td><td><strong>Topic</strong></td><td><strong>Writer</strong></td><td><strong>Status</strong></td></tr><tr><td>Oct 6</td><td>How we cut page load time in half</td><td>Priya</td><td>Editing</td></tr><tr><td>Oct 13</td><td>A plain guide to block themes</td><td>Sofia</td><td>Drafting</td></tr><tr><td>Oct 20</td><td>Client case study: Northwind</td><td>Maria</td><td>Interview booked</td></tr><tr><td>Oct 27</td><td>Our WordPress maintenance checklist</td><td>Rahul</td><td>Idea</td></tr></tbody></table>', array( 'folder' => $folders['Content'], 'color' => '#3d8bfd' ), 0, 8.5 );
NoteFlow_Access::set_share( $calendar, '', array( $S => 'edit', $M => 'view', $R => 'view' ) );

$onboarding = nf_demo_note( $P, 'New client onboarding', '<p>Send this list to every new client in the first week.</p><ul class="nf-checklist"><li class="nf-checked">Kick-off call booked</li><li class="nf-checked">Admin access and hosting details</li><li>Brand assets: logo, colours, fonts</li><li>Google Analytics and Search Console access</li><li>Content owner named</li></ul>', array( 'folder' => $folders['Clients'] ), 12, 15 );
NoteFlow_User_State::set_pin( $P, $onboarding, true );

$sync = nf_demo_note( $P, 'Weekly sync, 22 September', '<p><strong>Attendees:</strong> Priya, Maria, Rahul, Sofia</p><h2>Agenda</h2><ol><li>Northwind launch</li><li>October content</li><li>Hosting renewals</li></ol><h2>Action items</h2><ul class="nf-checklist"><li class="nf-checked">Rahul: redirects and crawl</li><li>Maria: case study interview</li><li>Sofia: first draft on block themes</li></ul>', array( 'folder' => $folders['Meetings'] ), 2, 10 );
NoteFlow_Access::set_share( $sync, '', array( $M => 'view', $R => 'view', $S => 'view' ) );

$audit = nf_demo_note( $P, 'Plugin audit for Northwind', '<p>Found during the relaunch. #maintenance</p><ul><li><strong>Contact Form Pro</strong>: two major versions behind, update on staging first</li><li><strong>Slider Revolution</strong>: only used on one page, replace with a Cover block</li><li><strong>Old SEO plugin</strong>: move settings over, then remove</li></ul><p>Keep: caching, backups, security.</p>', array( 'folder' => $folders['Clients'], 'color' => '#ff9f0a' ), 1, 16.5 );

$homepage = nf_demo_note( $P, 'Homepage copy, v3', '<h2>Hero</h2><p>Coffee roasted on the coast, delivered to your door every other Monday.</p><h2>Why Northwind</h2><p>We buy directly from twelve farms and roast in small batches, so every bag tastes the way it should.</p><blockquote>Keep it warm and short. Anna</blockquote>', array( 'folder' => $folders['Clients'] ), 4, 11 );

$newsletter = nf_demo_note( $P, 'Newsletter ideas', '<ul class="nf-dashed"><li>Behind the scenes of a site launch</li><li>Five plugins we remove from every new client site</li><li>A short guide to accessible colour contrast</li><li>What we learned moving 40 sites to PHP 8.3</li></ul><p>#newsletter</p>', array( 'folder' => $folders['Ideas'] ), 6, 18 );

$img = wp_get_attachment_image_url( 85, 'large' );
$brand = nf_demo_note( $P, 'Northwind brand colours', '<p>From the 2026 brand refresh. Use Harbour for headings and Lantern for buttons.</p><p><img src="' . esc_url( $img ) . '" alt="Northwind brand colours"></p>', array( 'folder' => $folders['Ideas'], 'color' => '#f5c400' ), 0, 12 );

// A post the SEO note is attached to.
$post_id = wp_insert_post( array( 'post_title' => 'How we cut our page load time in half', 'post_status' => 'draft', 'post_author' => $P, 'post_content' => "<!-- wp:paragraph -->\n<p>Last month our homepage took 4.2 seconds to load on a phone. Today it takes 1.9. Here is everything we changed, in the order we changed it.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">1. We measured first</h2>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>Before touching anything, we ran every template through a lab test and wrote down the numbers.</p>\n<!-- /wp:paragraph -->" ) );
$seo = nf_demo_note( $P, 'Edits for the page speed post', '<ul class="nf-checklist"><li class="nf-checked">Add before and after numbers to the intro</li><li>Shorten section 3</li><li>Add a screenshot of the waterfall chart</li></ul>', array( 'folder' => $folders['Content'], 'linked' => $post_id ), 0, 7.5 );
$seo2 = nf_demo_note( $S, 'Link the image guide in step 2', '<p>Could we link to the image optimisation guide from step 2? It answers the most common question we get.</p>', array( 'linked' => $post_id ), 0, 7.9 );
NoteFlow_Access::set_share( $seo2, '', array( $P => 'edit' ) );

// Shared by Maria.
$podcast = nf_demo_note( $M, 'Podcast guest list', '<p>People to invite this season.</p><ul class="nf-checklist"><li class="nf-checked">Someone who runs a WooCommerce store</li><li>An accessibility specialist</li><li>An agency founder we met at WordCamp</li></ul>', array(), 1, 12 );
NoteFlow_Access::set_share( $podcast, '', array( $P => 'edit' ) );

// Notifications for Priya.
update_user_option( $P, 'noteflow_notifications', array(
	array( 'id' => 'demo1', 'type' => 'mention', 'note' => $launch, 'actor' => $M, 'text' => 'Forms send fine now. @Priya Sharma can you check the site on your phone before Thursday?', 'time' => time() - 42 * MINUTE_IN_SECONDS, 'read' => false ),
	array( 'id' => 'demo2', 'type' => 'share', 'note' => $podcast, 'actor' => $M, 'text' => 'edit', 'time' => time() - DAY_IN_SECONDS, 'read' => true ),
) );

update_option( 'noteflow_demo_ids', array( $seo2, $podcast, $post_id ) );
update_option( 'noteflow_demo', array( 'launch' => $launch, 'calendar' => $calendar, 'post' => $post_id, 'podcast' => $podcast, 'brand' => $brand ) );
echo wp_json_encode( get_option( 'noteflow_demo' ) ), "\n";
