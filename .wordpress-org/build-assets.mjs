/**
 * Builds the wordpress.org listing assets for NoteFlow.
 *
 *   node .wordpress-org/build-assets.mjs                 icon PNGs and banners
 *   node .wordpress-org/build-assets.mjs --screenshots   also the eight screenshots
 *
 * The icon PNGs come from icon.svg and the banners from source/banner.html, rendered in
 * headless Chrome at the exact sizes wordpress.org expects.
 *
 * Screenshots are taken from the real app on a local site with the demo workspace from
 * source/demo.php (wp eval-file .wordpress-org/source/demo.php). People sign in through
 * short-lived WP-CLI sessions that are destroyed afterwards. While shooting, a temporary
 * must-use plugin limits the demo user's lists to their own notes and notes the demo cast
 * shared with them, so other notes on the site stay out of frame. Nothing changes for
 * anyone else, and the file is removed when the script ends.
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

async function openApp( page, query ) {
	await page.goto( SITE_URL + '/wp-admin/admin.php?page=noteflow-notes' + ( query || '' ), { waitUntil: 'networkidle0' } );
	await page.waitForSelector( '.nf-note:not(.is-loading) .nf-content' );
}

/** Rests the pointer where it hovers nothing, away from the toolbar's menus. */
const park = ( page ) => page.mouse.move( 1439, 899 );

async function shoot( page, name ) {
	await park( page );
	await sleep( 350 );
	await page.screenshot( { path: join( HERE, name ) } );
	report( name );
}

async function screenshots( browser ) {
	const demo = JSON.parse( wp( 'option', 'get', 'noteflow_demo', '--format=json' ) );
	const launch = demo.launch;
	const setPrefs = ( login, prefs ) => wp( 'eval', `update_user_option( get_user_by( "login", "${ login }" )->ID, "noteflow_prefs", array_merge( NoteFlow_User_State::prefs( get_user_by( "login", "${ login }" )->ID ), json_decode( '${ JSON.stringify( prefs ) }', true ) ) );` );
	setPrefs( 'priya', { theme: 'light', view: 'list', sort: 'modified', group: true } );

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

	// 1. The app, with the shared checklist open and people in it.
	await openApp( priya, '&note=' + launch );
	await priya.click( '.nf-row.is-selected' );
	await priya.waitForFunction( () => document.querySelectorAll( '.nf-presence-item' ).length === 2 && document.querySelector( '.nf-presence-item.is-editing' ), { timeout: 40000 } );
	await shoot( priya, 'screenshot-1.png' );

	// 2. Sharing.
	await priya.click( '[data-action="share"]' );
	await priya.waitForSelector( '.nf-share-list li:nth-child(3)' );
	await priya.evaluate( () => document.activeElement.blur() );
	await shoot( priya, 'screenshot-2.png' );
	await priya.keyboard.press( 'Escape' );

	// 3. Comments with people in the note.
	await priya.click( '[data-action="activity"]' );
	await priya.waitForSelector( '.nf-comment' );
	await priya.type( '.nf-comment-form textarea', 'Checked on my phone: all good. ' );
	await shoot( priya, 'screenshot-3.png' );

	clearInterval( typing );

	// 4. Version history: preview Rahul's version.
	await priya.evaluate( () => ( document.querySelector( '.nf-comment-form textarea' ).value = '' ) );
	await priya.click( '[data-tab="history"]' );
	await priya.waitForSelector( '.nf-revision' );
	await priya.evaluate( () => {
		const rows = Array.from( document.querySelectorAll( '.nf-revision' ) );
		( rows.find( ( r ) => r.textContent.includes( 'Rahul' ) ) || rows[ 1 ] ).click();
	} );
	await priya.waitForSelector( '[data-action="preview-restore"]' );
	await priya.mouse.move( 0, 0 );
	await shoot( priya, 'screenshot-4.png' );
	await priya.click( '[data-action="preview-close"]' );
	await priya.click( '[data-activity-close]' );

	// 5. Gallery view, dark.
	setPrefs( 'priya', { theme: 'dark', view: 'gallery' } );
	await priya.goto( SITE_URL + '/wp-admin/admin.php?page=noteflow-notes', { waitUntil: 'networkidle0' } );
	await priya.waitForSelector( '.nf-card' );
	await priya.click( '.nf-card' );
	await priya.waitForSelector( '.nf-app.is-gallery-open' );
	await priya.click( '[data-action="back"]' );
	await shoot( priya, 'screenshot-5.png' );
	setPrefs( 'priya', { theme: 'light', view: 'list' } );

	// 6. Quick capture and the Dashboard widget.
	await priya.goto( SITE_URL + '/wp-admin/index.php', { waitUntil: 'networkidle0' } );
	await priya.click( '#wp-admin-bar-noteflow-quick > a' );
	await priya.waitForSelector( '.nf-q-pop' );
	await priya.type( '.nf-q-title', 'Call Anna about launch time' );
	await priya.type( '.nf-q-text', 'She would like 10 am Pacific.\n[] Confirm with Rahul\n[] Update the launch checklist' );
	await shoot( priya, 'screenshot-6.png' );
	await priya.keyboard.press( 'Escape' );

	// 7. Notes on a post, in the block editor.
	await priya.goto( SITE_URL + '/wp-admin/post.php?post=' + demo.post + '&action=edit', { waitUntil: 'networkidle0' } );
	await sleep( 1500 );
	await priya.evaluate( () => document.querySelector( '.components-modal__screen-overlay button[aria-label="Close"]' )?.click() );
	await sleep( 500 );
	await priya.evaluate( () => document.querySelector( '#noteflow-content-notes' )?.scrollIntoView( { block: 'center' } ) );
	await priya.mouse.move( 0, 0 );
	await shoot( priya, 'screenshot-7.png' );

	// 8. Settings.
	const admin = await pageFor( browser, 'admin', 1440, 1180 );
	await admin.goto( SITE_URL + '/wp-admin/admin.php?page=noteflow-settings', { waitUntil: 'networkidle0' } );
	await admin.evaluate( () => document.querySelectorAll( '.notice' ).forEach( ( n ) => n.remove() ) );
	await shoot( admin, 'screenshot-8.png' );
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
