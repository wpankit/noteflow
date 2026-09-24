/**
 * Builds the wordpress.org listing assets for NoteFlow.
 *
 *   node .wordpress-org/build-assets.mjs                 icon PNGs and banners
 *   node .wordpress-org/build-assets.mjs --screenshots   also the screenshots
 *   node .wordpress-org/build-assets.mjs --screenshots --only=settings,posts   just those
 *
 * The icon PNGs come from icon.svg and the banners from source/banner.html, rendered in
 * headless Chrome at the exact sizes wordpress.org expects.
 *
 * Screenshots are taken from the real app on a local site with the demo workspace from
 * source/demo.php (wp eval-file .wordpress-org/source/demo.php). People sign in through
 * short-lived WP-CLI sessions that are destroyed afterwards. While shooting, a temporary
 * must-use plugin limits the demo user's notes and Posts screen to the demo content, so
 * nothing else on the site shows up, and opens the classic editor when a URL asks. It
 * changes nothing for anyone else and is removed when the script ends. Edits made for a
 * screenshot are never saved, except on a throwaway note that is deleted straight away.
 *
 * Needs Google Chrome, plus puppeteer-core and the Inter and Manrope fonts from the
 * WPAnkit Product theme's QA tools (set NF_QA_DIR if they live elsewhere). Screenshots
 * also need WP-CLI and the site: set NF_SITE_PATH, NF_SITE_URL and NF_DB_SOCKET.
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, unlinkSync, readdirSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname( fileURLToPath( import.meta.url ) );
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const QA = process.env.NF_QA_DIR || join( homedir(), 'Local Sites/pushrow-lp/app/public/wp-content/themes/wpankit-product/tools/qa' );
const SITE_PATH = process.env.NF_SITE_PATH || join( homedir(), 'Local Sites/other-plugin/app/public' );
const SITE_URL = process.env.NF_SITE_URL || 'http://other-plugin.local';
const DB_SOCKET = process.env.NF_DB_SOCKET || join( homedir(), 'Library/Application Support/Local/run/kdrgZVwMM/mysql/mysqld.sock' );

for ( const [ what, path ] of [
	[ 'Google Chrome', CHROME ],
	[ 'puppeteer-core from the theme QA tools', join( QA, 'node_modules/puppeteer-core' ) ],
	[ 'Inter and Manrope from the theme QA tools', join( QA, 'node_modules/@fontsource/manrope' ) ],
] ) {
	if ( ! existsSync( path ) ) {
		console.error( `${ what } not found at ${ path }` );
		process.exit( 1 );
	}
}

const puppeteer = createRequire( join( QA, 'package.json' ) )( 'puppeteer-core' );
const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

// Fonts are inlined: pages loaded with setContent can't read file:// URLs.
const font = ( family, pkg, weight ) =>
	`@font-face{font-family:${ family };font-weight:${ weight };src:url(data:font/woff2;base64,${ readFileSync( join( QA, 'node_modules/@fontsource', pkg, 'files', `${ pkg }-latin-${ weight }-normal.woff2` ) ).toString( 'base64' ) }) format("woff2")}`;
const FONTS = [ font( 'Inter', 'inter', 500 ), font( 'Inter', 'inter', 600 ), font( 'Inter', 'inter', 700 ), font( 'Manrope', 'manrope', 800 ) ].join( '\n' );

const dataUri = ( file, type ) => `data:${ type };base64,` + readFileSync( file ).toString( 'base64' );
const iconUri = dataUri( join( HERE, 'icon.svg' ), 'image/svg+xml' );

function pngSize( file ) {
	const b = readFileSync( file );
	return [ b.readUInt32BE( 16 ), b.readUInt32BE( 20 ) ];
}

function report( name ) {
	const [ w, h ] = pngSize( join( HERE, name ) );
	console.log( `${ name }  ${ w }x${ h }  ${ Math.round( statSync( join( HERE, name ) ).size / 1024 ) } KB` );
	return [ w, h ];
}

function check( name, width, height ) {
	const [ w, h ] = report( name );
	if ( w !== width || h !== height ) {
		throw new Error( `${ name } is ${ w }x${ h }, expected ${ width }x${ height }` );
	}
}

/* WP-CLI ------------------------------------------------------------------------------- */

const wp = ( ...args ) =>
	execFileSync( 'php', [ '-d', 'error_reporting=0', '-d', 'display_errors=0', '-d', `mysqli.default_socket=${ DB_SOCKET }`, '/usr/local/bin/wp', `--path=${ SITE_PATH }`, ...args ], { encoding: 'utf8' } );

const sessions = [];

function session( login ) {
	const s = JSON.parse(
		wp(
			'eval',
			`$u = get_user_by( "login", "${ login }" ); $exp = time() + 1800; $t = WP_Session_Tokens::get_instance( $u->ID )->create( $exp ); echo json_encode( array( "uid" => $u->ID, "token" => $t, "cookies" => array( array( "name" => AUTH_COOKIE, "value" => wp_generate_auth_cookie( $u->ID, $exp, "auth", $t ) ), array( "name" => LOGGED_IN_COOKIE, "value" => wp_generate_auth_cookie( $u->ID, $exp, "logged_in", $t ) ) ) ) );`
		)
	);
	sessions.push( s );
	return s;
}

async function pageFor( browser, login, width = 1440, height = 900 ) {
	const context = await browser.createBrowserContext();
	const page = await context.newPage();
	const s = session( login );
	await page.setCookie( ...s.cookies.map( ( c ) => ( { ...c, domain: new URL( SITE_URL ).hostname, path: '/' } ) ) );
	await page.setViewport( { width, height, deviceScaleFactor: 1.5 } );
	await page.emulateMediaFeatures( [ { name: 'prefers-reduced-motion', value: 'reduce' } ] );
	// The demo workspace's times are written in UTC.
	await page.emulateTimezone( 'UTC' );
	return page;
}

/* Screenshots ------------------------------------------------------------------------------ */

/** Screenshot names, in the order the readme lists them: screenshot-1.png is 'app'. */
const SHOTS = [
	'app', 'discussion', 'links', 'share', 'comments', 'conflict', 'history', 'bell', 'posts', 'classic', 'post-notes',
	'capture', 'capture-site', 'templates', 'format', 'search', 'note-menu', 'gallery', 'accent', 'shortcuts', 'phone', 'settings',
];
const fileFor = ( key ) => `screenshot-${ SHOTS.indexOf( key ) + 1 }.png`;
const ONLY = ( process.argv.find( ( arg ) => arg.startsWith( '--only=' ) ) || '' ).slice( 7 ).split( ',' ).filter( Boolean );
const wanted = ( key ) => ! ONLY.length || ONLY.includes( key );

async function openApp( page, query ) {
	await page.goto( SITE_URL + '/wp-admin/admin.php?page=noteflow-notes' + ( query || '' ), { waitUntil: 'networkidle0' } );
	await page.waitForSelector( '.nf-note:not(.is-loading) .nf-content' );
}

async function openEditor( page, postId, query ) {
	await page.goto( SITE_URL + '/wp-admin/post.php?post=' + postId + '&action=edit' + ( query || '' ), { waitUntil: 'networkidle0' } );
}

/** Rests the pointer where it hovers nothing, away from the toolbar's menus. */
const park = ( page ) => page.mouse.move( 1439, 899 );

async function shoot( page, key ) {
	if ( ! SHOTS.includes( key ) ) {
		throw new Error( 'Unknown screenshot ' + key );
	}
	if ( ! wanted( key ) ) {
		return;
	}
	await park( page );
	await sleep( 350 );
	await page.screenshot( { path: join( HERE, fileFor( key ) ) } );
	report( fileFor( key ) );
}

/** Puts the caret at the end of an element in the note editor. */
const caretAtEnd = ( page, selector, index ) =>
	page.evaluate(
		( sel, i ) => {
			const content = document.querySelector( '.nf-content' );
			const list = content.querySelectorAll( sel );
			const target = list[ i < 0 ? list.length + i : i ];
			content.focus();
			const range = document.createRange();
			range.selectNodeContents( target );
			range.collapse( false );
			window.getSelection().removeAllRanges();
			window.getSelection().addRange( range );
		},
		selector,
		index
	);

/** Stops a page's note saves from reaching the site, so demo notes stay as they are. */
async function dropSaves( page ) {
	await page.setRequestInterception( true );
	page.on( 'request', ( request ) => {
		if ( request.method() === 'POST' && /noteflow\/v1\/notes\/\d+(\?|$)/.test( request.url() ) ) {
			return; // Left pending until the page closes.
		}
		request.continue();
	} );
}

async function screenshots( browser ) {
	const demo = JSON.parse( wp( 'option', 'get', 'noteflow_demo', '--format=json' ) );
	const launch = demo.launch;
	const setPrefs = ( login, prefs ) => wp( 'eval', `update_user_option( get_user_by( "login", "${ login }" )->ID, "noteflow_prefs", array_merge( NoteFlow_User_State::prefs( get_user_by( "login", "${ login }" )->ID ), json_decode( '${ JSON.stringify( prefs ) }', true ) ) );` );
	setPrefs( 'priya', { theme: 'light', view: 'list', sort: 'modified', group: true, accent: 'amber' } );

	const priya = await pageFor( browser, 'priya' );

	// Maria and Rahul have the launch note open, and Rahul is typing. His saves are
	// dropped, so the note stays as the demo left it.
	const maria = await pageFor( browser, 'maria', 1200, 800 );
	const rahul = await pageFor( browser, 'rahul', 1200, 800 );
	await rahul.setRequestInterception( true );
	rahul.on( 'request', ( request ) => ( request.method() === 'POST' && /noteflow\/v1\/notes\/\d+(\?|$)/.test( request.url() ) ? request.abort() : request.continue() ) );
	await openApp( maria, '&note=' + launch );
	await openApp( rahul, '&note=' + launch );
	const typing = setInterval( () => rahul.evaluate( () => {
		const title = document.querySelector( '.nf-title' );
		title.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	} ).catch( () => {} ), 1000 );

	// The app, with the shared checklist open and people in it.
	await openApp( priya, '&note=' + launch );
	await priya.click( '.nf-row.is-selected' );
	await priya.waitForFunction( () => document.querySelectorAll( '.nf-presence-item' ).length === 2 && document.querySelector( '.nf-presence-item.is-editing' ), { timeout: 40000 } );
	await shoot( priya, 'app' );

	// Sharing.
	await priya.click( '[data-action="share"]' );
	await priya.waitForSelector( '.nf-share-list li:nth-child(3)' );
	await priya.evaluate( () => document.activeElement.blur() );
	await shoot( priya, 'share' );
	await priya.keyboard.press( 'Escape' );

	// Comments with people in the note.
	await priya.click( '[data-action="activity"]' );
	await priya.waitForSelector( '.nf-comment' );
	await priya.type( '.nf-comment-form textarea', 'Checked on my phone: all good. ' );
	await shoot( priya, 'comments' );

	clearInterval( typing );
	await maria.close();
	await rahul.close();

	// Version history: preview Rahul's version.
	await priya.evaluate( () => ( document.querySelector( '.nf-comment-form textarea' ).value = '' ) );
	await priya.click( '[data-tab="history"]' );
	await priya.waitForSelector( '.nf-revision' );
	await priya.evaluate( () => {
		const rows = Array.from( document.querySelectorAll( '.nf-revision' ) );
		( rows.find( ( r ) => r.textContent.includes( 'Rahul' ) ) || rows[ 1 ] ).click();
	} );
	await priya.waitForSelector( '[data-action="preview-restore"]' );
	await priya.mouse.move( 0, 0 );
	await shoot( priya, 'history' );
	await priya.click( '[data-action="preview-close"]' );
	await priya.click( '[data-activity-close]' );

	// Everything a note can do, from its More menu.
	await priya.click( '.nf-row.is-selected' );
	await priya.click( '[data-action="more"]' );
	await priya.waitForSelector( '.nf-menu' );
	await shoot( priya, 'note-menu' );
	await priya.keyboard.press( 'Escape' );

	// Keyboard shortcuts.
	await priya.click( '.nf-row.is-selected' );
	await priya.keyboard.press( '?' );
	await priya.waitForSelector( '.nf-backdrop' );
	await shoot( priya, 'shortcuts' );
	await priya.keyboard.press( 'Escape' );

	// Two people change the same line at once. A throwaway note, shared with Rahul: his
	// edit is saved while Priya's save is on its way, and NoteFlow asks which to keep.
	const clashId = Number(
		wp(
			'eval',
			`$p = get_user_by( 'login', 'priya' )->ID; $r = get_user_by( 'login', 'rahul' )->ID; wp_set_current_user( $p ); $n = NoteFlow_Notes::create( $p, array( 'title' => 'Homepage hero, final wording', 'content' => '<p>For the new Northwind homepage. Anna picks one on Wednesday.</p><p>Coffee roasted on the coast, delivered to your door every other Monday.</p><p>Small batches from twelve farms.</p>' ) ); NoteFlow_Access::set_share( $n->ID, '', array( $r => 'edit' ) ); echo $n->ID;`
		).trim()
	);
	try {
		const clash = await pageFor( browser, 'priya' );
		await clash.setRequestInterception( true );
		let held = false;
		clash.on( 'request', ( request ) => {
			if ( ! held && request.method() === 'POST' && new RegExp( 'noteflow/v1/notes/' + clashId + '(\\?|$)' ).test( request.url() ) ) {
				held = true;
				wp( 'eval', `$r = get_user_by( 'login', 'rahul' ); wp_set_current_user( $r->ID ); $post = get_post( ${ clashId } ); NoteFlow_Notes::update_content( $post, $r->ID, array( 'content' => NoteFlow_Notes::sanitize_content( str_replace( 'Coffee roasted on the coast, delivered to your door every other Monday.', 'Fresh coffee from the coast, at your door every other Monday.', $post->post_content ) ) ), NoteFlow_Notes::version( $post ), true );` );
			}
			request.continue();
		} );
		await openApp( clash, '&note=' + clashId );
		await caretAtEnd( clash, 'p', 1 );
		await clash.keyboard.type( ' No contract, cancel any time.', { delay: 25 } );
		await clash.waitForSelector( '[data-action="conflict-mine"]', { timeout: 20000 } );
		await shoot( clash, 'conflict' );
		await clash.close();
	} finally {
		wp( 'eval', `wp_delete_post( ${ clashId }, true );` );
	}

	// Linking to a post, page or note by typing [[.
	const linker = await pageFor( browser, 'priya' );
	await dropSaves( linker );
	await openApp( linker, '&note=' + demo.newsletter );
	await caretAtEnd( linker, 'li', -1 );
	await linker.keyboard.press( 'Enter' );
	await linker.keyboard.type( 'Case study: [[page', { delay: 40 } );
	await linker.waitForFunction( () => document.querySelectorAll( '.nf-link-suggest li' ).length >= 3 );
	await sleep( 400 );
	await shoot( linker, 'links' );
	await linker.close();

	// Templates.
	await openApp( priya, '&note=' + launch );
	await priya.click( '[data-action="templates"]' );
	await priya.waitForSelector( '.nf-menu' );
	await shoot( priya, 'templates' );
	await priya.keyboard.press( 'Escape' );

	// Formatting, on the note with a table.
	await openApp( priya, '&note=' + demo.calendar );
	await caretAtEnd( priya, 'p', 0 );
	await priya.click( '[data-action="format"]' );
	await priya.waitForSelector( '.nf-menu' );
	await shoot( priya, 'format' );
	await priya.keyboard.press( 'Escape' );

	// Search.
	await openApp( priya, '&note=' + launch );
	await priya.type( '.nf-search-input', 'launch' );
	await sleep( 900 );
	await shoot( priya, 'search' );

	// Gallery view, dark.
	setPrefs( 'priya', { theme: 'dark', view: 'gallery' } );
	await priya.goto( SITE_URL + '/wp-admin/admin.php?page=noteflow-notes', { waitUntil: 'networkidle0' } );
	await priya.waitForSelector( '.nf-card' );
	await priya.click( '.nf-card' );
	await priya.waitForSelector( '.nf-app.is-gallery-open' );
	await priya.click( '[data-action="back"]' );
	await shoot( priya, 'gallery' );

	// Accent colours, in Preferences.
	setPrefs( 'priya', { theme: 'light', view: 'list', accent: 'blue' } );
	try {
		await openApp( priya, '&note=' + launch );
		await priya.click( '[data-action="prefs"]' );
		await priya.waitForSelector( '.nf-popover' );
		await shoot( priya, 'accent' );
		await priya.keyboard.press( 'Escape' );
	} finally {
		setPrefs( 'priya', { accent: 'amber' } );
	}

	// The notification bell, open on the Dashboard.
	await priya.goto( SITE_URL + '/wp-admin/index.php', { waitUntil: 'networkidle0' } );
	await priya.evaluate( () => document.querySelector( '#wp-admin-bar-noteflow-bell' ).classList.add( 'hover' ) );
	await shoot( priya, 'bell' );
	await priya.evaluate( () => document.querySelector( '#wp-admin-bar-noteflow-bell' ).classList.remove( 'hover' ) );

	// Quick capture and the Dashboard widget.
	await priya.click( '#wp-admin-bar-noteflow-quick > a' );
	await priya.waitForSelector( '.nf-q-pop' );
	await priya.type( '.nf-q-title', 'Call Anna about launch time' );
	await priya.type( '.nf-q-text', 'She would like 10 am Pacific.\n[] Confirm with Rahul\n[] Update the launch checklist' );
	await shoot( priya, 'capture' );
	await priya.keyboard.press( 'Escape' );

	// Quick capture on the site, on the post Priya is reading.
	await priya.goto( SITE_URL + '/?p=' + demo.post + '&preview=true', { waitUntil: 'networkidle0' } );
	await priya.click( '#wp-admin-bar-noteflow-quick > a' );
	await priya.waitForSelector( '.nf-q-pop' );
	await priya.type( '.nf-q-title', 'Follow-up post idea' );
	await priya.type( '.nf-q-text', 'Readers keep asking about fonts.\n[] Compare system fonts and web fonts\n[] Ask Rahul for the lab numbers' );
	await shoot( priya, 'capture-site' );
	await priya.keyboard.press( 'Escape' );

	// The Posts screen, with open comments and issues per post, cropped below the table.
	await priya.goto( SITE_URL + '/wp-admin/edit.php', { waitUntil: 'networkidle0' } );
	await priya.evaluate( () => document.querySelectorAll( '.subsubsub .count, .notice' ).forEach( ( el ) => el.remove() ) );
	const tableEnd = await priya.evaluate( () => document.querySelector( '.wp-list-table' ).getBoundingClientRect().bottom );
	await priya.setViewport( { width: 1440, height: Math.ceil( tableEnd ) + 6, deviceScaleFactor: 1.5 } );
	await shoot( priya, 'posts' );
	await priya.setViewport( { width: 1440, height: 900, deviceScaleFactor: 1.5 } );

	// A discussion in the classic editor.
	await openEditor( priya, demo.guide, '&nf_demo_classic=1' );
	await priya.waitForSelector( '#noteflow-discussion .nfd-thread' );
	await shoot( priya, 'classic' );

	// A discussion on a post in the block editor, with the paragraph that has the open
	// issue selected, so its thread is marked and the block toolbar shows.
	await openEditor( priya, demo.post );
	await sleep( 1500 );
	await priya.evaluate( () => document.querySelector( '.components-modal__screen-overlay button[aria-label="Close"]' )?.click() );
	await priya.evaluate( () => window.wp.data.dispatch( 'core/edit-post' ).openGeneralSidebar( 'noteflow/noteflow-sidebar' ) );
	await priya.waitForSelector( '.nfd-sidebar .nfd-thread' );
	await priya.evaluate( () => {
		const find = ( list ) => {
			for ( const block of list ) {
				if ( block.attributes.metadata && 'nfdemochart' === block.attributes.metadata.noteflowId ) {
					return block.clientId;
				}
				const inner = find( block.innerBlocks || [] );
				if ( inner ) {
					return inner;
				}
			}
			return '';
		};
		window.wp.data.dispatch( 'core/block-editor' ).selectBlock( find( window.wp.data.select( 'core/block-editor' ).getBlocks() ) );
	} );
	await sleep( 800 );
	await shoot( priya, 'discussion' );

	// The notes attached to the same post.
	await priya.evaluate( () => window.wp.data.dispatch( 'core/block-editor' ).clearSelectedBlock() );
	await priya.click( '.nfd-sidebar [data-tab="notes"]' );
	await priya.waitForSelector( '.nfd-notes a' );
	await priya.type( '.nfd-note-form textarea', 'Swap the first two sentences before Maria reviews it.' );
	await shoot( priya, 'post-notes' );

	// On a phone: folders, the list and a note, side by side.
	const phone = await pageFor( browser, 'priya', 390, 844 );
	await phone.setUserAgent( 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' );
	await phone.goto( SITE_URL + '/wp-admin/admin.php?page=noteflow-notes', { waitUntil: 'networkidle0' } );
	await sleep( 500 );
	const listShot = await phone.screenshot();
	await phone.click( '[data-action="show-sidebar"]' );
	await sleep( 500 );
	const foldersShot = await phone.screenshot();
	await openApp( phone, '&note=' + launch );
	await sleep( 500 );
	const noteShot = await phone.screenshot();
	await phone.close();
	const frame = ( png ) => `<div class="phone"><img src="data:image/png;base64,${ Buffer.from( png ).toString( 'base64' ) }" alt=""></div>`;
	const board = await browser.newPage();
	await board.setViewport( { width: 1440, height: 900, deviceScaleFactor: 1.5 } );
	await board.setContent(
		'<html><head><style>body{margin:0;height:900px;display:flex;align-items:center;justify-content:center;gap:64px;background:linear-gradient(135deg,#fffaf0 0%,#fff1c7 55%,#ffe39a 100%)}' +
		'.phone{width:352px;padding:11px;border-radius:50px;background:#1c1c1e;box-shadow:0 2px 0 1px #3a3a3c inset,0 34px 70px rgba(90,60,0,.28)}' +
		'.phone img{display:block;width:100%;border-radius:40px}</style></head><body>' +
		frame( foldersShot ) + frame( listShot ) + frame( noteShot ) +
		'</body></html>',
		{ waitUntil: 'load' }
	);
	if ( wanted( 'phone' ) ) {
		await board.screenshot( { path: join( HERE, fileFor( 'phone' ) ) } );
		report( fileFor( 'phone' ) );
	}
	await board.close();

	// Settings.
	const admin = await pageFor( browser, 'admin', 1440, 1180 );
	await admin.goto( SITE_URL + '/wp-admin/admin.php?page=noteflow-settings&nf_demo=1', { waitUntil: 'networkidle0' } );
	await admin.evaluate( () => document.querySelectorAll( '.notice' ).forEach( ( n ) => n.remove() ) );
	// Tall enough for every module and the Save button.
	const tall = await admin.evaluate( () => document.querySelector( '#wpbody-content' ).getBoundingClientRect().bottom );
	await admin.setViewport( { width: 1440, height: Math.min( 1700, Math.ceil( tall ) + 24 ), deviceScaleFactor: 1.5 } );
	await shoot( admin, 'settings' );

	// No screenshots left over from an earlier, longer list.
	for ( const name of readdirSync( HERE ) ) {
		const n = /^screenshot-(\d+)\.png$/.exec( name );
		if ( n && Number( n[ 1 ] ) > SHOTS.length ) {
			unlinkSync( join( HERE, name ) );
		}
	}
}

/* Build ---------------------------------------------------------------------------------- */

const MU_DIR = join( SITE_PATH, 'wp-content/mu-plugins' );
const MU_FILE = join( MU_DIR, 'noteflow-screenshots.php' );
const MU_PLUGIN = `<?php
// Temporary, written and removed by NoteFlow's build-assets.mjs: the demo user's lists
// show only their own notes and notes the demo cast shared with them directly, so other
// notes on this site stay out of screenshots.
add_filter( 'noteflow_accessible_ids', function ( $ids, $user_id ) {
	$user = get_userdata( $user_id );
	if ( ! $user || 'priya' !== $user->user_login ) {
		return $ids;
	}
	$cast = array();
	foreach ( array( 'priya', 'maria', 'rahul', 'sofia' ) as $login ) {
		$person = get_user_by( 'login', $login );
		if ( $person ) {
			$cast[] = (int) $person->ID;
		}
	}
	return array_values( array_filter( $ids, function ( $id ) use ( $cast, $user ) {
		$author = (int) get_post_field( 'post_author', $id );
		$share  = NoteFlow_Access::get_share( $id );
		return in_array( $author, $cast, true ) && ( $author === (int) $user->ID || isset( $share['users'][ (int) $user->ID ] ) );
	} ) );
}, 10, 2 );

// The Posts screen lists only the demo posts for the demo user.
add_action( 'pre_get_posts', function ( $query ) {
	if ( ! is_admin() || ! $query->is_main_query() || 'priya' !== wp_get_current_user()->user_login ) {
		return;
	}
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	$demo   = get_option( 'noteflow_demo' );
	if ( $screen && 'edit-post' === $screen->id && ! empty( $demo['posts'] ) ) {
		$query->set( 'post__in', array_map( 'intval', $demo['posts'] ) );
	}
} );

// nf_demo_classic in the URL opens a post in the classic editor.
add_filter( 'use_block_editor_for_post', function ( $use ) {
	return isset( $_GET['nf_demo_classic'] ) ? false : $use;
} );

// A made-up site name for the demo user, and for requests marked nf_demo.
add_filter( 'option_blogname', function ( $name ) {
	if ( ! did_action( 'init' ) ) {
		return $name;
	}
	return isset( $_GET['nf_demo'] ) || 'priya' === wp_get_current_user()->user_login ? 'Pinewood Studio' : $name;
} );
`;

const browser = await puppeteer.launch( { executablePath: CHROME, headless: 'new' } );
let wroteMu = false;
const hadMuDir = existsSync( MU_DIR );

try {
	if ( process.argv.includes( '--screenshots' ) ) {
		mkdirSync( MU_DIR, { recursive: true } );
		writeFileSync( MU_FILE, MU_PLUGIN );
		wroteMu = true;
		await screenshots( browser );
	}

	const page = await browser.newPage();

	/* Icon */
	for ( const size of [ 128, 256 ] ) {
		await page.setViewport( { width: size, height: size, deviceScaleFactor: 1 } );
		await page.setContent( `<html><body style="margin:0;background:transparent"><img src="${ iconUri }" width="${ size }" height="${ size }" style="display:block"></body></html>` );
		const name = `icon-${ size }x${ size }.png`;
		await page.screenshot( { path: join( HERE, name ), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } } );
		check( name, size, size );
	}

	/* Banners */
	const banner = readFileSync( join( HERE, 'source/banner.html' ), 'utf8' )
		.replace( '/* FONTS: build-assets.mjs injects the Inter and Manrope @font-face rules here. */', FONTS )
		.replaceAll( 'ICON_URI', iconUri );

	for ( const [ width, height, scale ] of [ [ 772, 250, 1 ], [ 1544, 500, 2 ] ] ) {
		await page.setViewport( { width: 772, height: 250, deviceScaleFactor: scale } );
		await page.setContent( banner, { waitUntil: 'load' } );
		await page.evaluate( () => document.fonts.ready );
		const missing = await page.evaluate( () => [ '800 36px Manrope', '500 16px Inter', '600 12px Inter' ].filter( ( f ) => ! document.fonts.check( f ) ) );
		if ( missing.length ) {
			throw new Error( 'Fonts not loaded: ' + missing.join( ', ' ) );
		}
		const name = `banner-${ width }x${ height }.png`;
		await page.screenshot( { path: join( HERE, name ), clip: { x: 0, y: 0, width: 772, height: 250 } } );
		check( name, width, height );
	}
} finally {
	await browser.close();
	for ( const s of sessions ) {
		wp( 'eval', `WP_Session_Tokens::get_instance( ${ s.uid } )->destroy( "${ s.token }" );` );
	}
	if ( wroteMu && existsSync( MU_FILE ) ) {
		unlinkSync( MU_FILE );
		if ( ! hadMuDir && ! readdirSync( MU_DIR ).length ) {
			rmdirSync( MU_DIR );
		}
	}
}
