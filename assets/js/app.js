/**
 * NoteFlow: the notes app.
 *
 * Three panes (folders, notes, editor), autosave with version checks, live sync with
 * other people in the same note, sharing, comments, history, reminders and more.
 */
( function () {
	'use strict';

	const data = window.noteflowData;
	const mount = document.getElementById( 'noteflow-root' );
	if ( ! data || ! mount || ! window.NoteFlowEditor || ! window.NoteFlowUI ) {
		return;
	}

	const { __, _n, sprintf } = wp.i18n;
	const UI = window.NoteFlowUI;
	const { icon, esc } = UI;
	const Merge = window.NoteFlowMerge;
	const HTML = window.NoteFlowHTML;
	const NS = '/noteflow/v1';
	const isMac = /Mac|iPhone|iPad/.test( navigator.platform || navigator.userAgent );
	const MOD = isMac ? '⌘' : 'Ctrl+';
	const ALT = isMac ? '⌥' : 'Alt+';
	const SHIFT = isMac ? '⇧' : 'Shift+';
	const settings = data.settings || {};
	const modules = settings.modules || {};
	const me = data.user;
	const locale = document.documentElement.lang || navigator.language || 'en-US';

	const COLORS = [
		[ '', __( 'No colour', 'noteflow' ) ],
		[ '#ff5f57', __( 'Red', 'noteflow' ) ],
		[ '#ff9f0a', __( 'Orange', 'noteflow' ) ],
		[ '#f5c400', __( 'Yellow', 'noteflow' ) ],
		[ '#30c85e', __( 'Green', 'noteflow' ) ],
		[ '#3d8bfd', __( 'Blue', 'noteflow' ) ],
		[ '#a86bf5', __( 'Purple', 'noteflow' ) ],
		[ '#8e8e93', __( 'Graphite', 'noteflow' ) ],
	];

	/* API -------------------------------------------------------------------------------- */

	const api = {
		get: ( path, query ) => wp.apiFetch( { path: wp.url.addQueryArgs( NS + path, query || {} ) } ),
		post: ( path, body ) => wp.apiFetch( { path: NS + path, method: 'POST', data: body || {} } ),
		del: ( path, query ) => wp.apiFetch( { path: wp.url.addQueryArgs( NS + path, query || {} ), method: 'DELETE' } ),
	};

	const debug = ( label, value ) => window.NOTEFLOW_DEBUG && window.console.log( '[noteflow] ' + label + ' ' + JSON.stringify( value ) ); // eslint-disable-line no-console

	const errorMessage = ( err ) => ( err && err.message ) || __( 'Something went wrong. Please try again.', 'noteflow' );
	const failed = ( err ) => UI.toast( errorMessage( err ), { error: true } );

	const debounce = ( fn, wait ) => {
		let t;
		return ( ...args ) => {
			clearTimeout( t );
			t = setTimeout( () => fn( ...args ), wait );
		};
	};

	/* State ------------------------------------------------------------------------------ */

	const S = {
		notes: new Map(),
		people: Object.assign( {}, data.people || {} ),
		folders: data.folders || [],
		filed: Object.assign( {}, data.filed || {} ),
		pins: data.pins || [],
		prefs: Object.assign( {}, data.prefs ),
		notifications: data.notifications || { items: [], unread: 0 },
		view: 'all',
		search: '',
		results: null,
		selected: 0,
		current: null,
		pane: 'list',
		galleryOpen: false,
		syncedAt: data.now,
		created: new Set(),
		touched: new Map(),
		leftNote: 0,
		activity: '',
		comments: [],
		revisions: [],
		loadingActivity: false,
		preview: null,
		saveState: '',
		signedOut: false,
		mentions: new Set(),
		upgradeDismissed: false,
		reviewDismissed: false,
	};
	( data.notes || [] ).forEach( ( n ) => S.notes.set( n.id, n ) );

	const person = ( id ) => S.people[ id ] || { id, name: __( 'Someone', 'noteflow' ), avatar: '' };
	const isPinned = ( id ) => S.pins.includes( id );
	const folderExists = ( id ) => S.folders.some( ( f ) => f.id === id );
	const folderOf = ( n ) => ( S.filed[ n.id ] && folderExists( S.filed[ n.id ] ) ? S.filed[ n.id ] : '' );
	const folderName = ( id ) => ( id && ( S.folders.find( ( f ) => f.id === id ) || {} ).name ) || __( 'Notes', 'noteflow' );
	const noteTitle = ( n ) => ( n && n.title ) || __( 'New Note', 'noteflow' );
	const canEdit = ( n ) => !! n && ( n.role === 'owner' || n.role === 'edit' ) && n.status !== 'trash';
	const isShared = ( n ) => !! n && ( n.role !== 'owner' || n.shared );
	const isMobile = () => window.matchMedia( '(max-width: 782px)' ).matches;
	const touch = ( id ) => S.touched.set( id, Date.now() );

	function upsert( note ) {
		if ( ! note || ! note.id ) {
			return;
		}
		// Full notes carry this person's own filing and pin; keep the maps in step.
		if ( 'folder' in note ) {
			if ( note.folder ) {
				S.filed[ note.id ] = note.folder;
			} else {
				delete S.filed[ note.id ];
			}
		}
		if ( 'pinned' in note && note.pinned !== S.pins.includes( note.id ) ) {
			S.pins = note.pinned ? [ note.id ].concat( S.pins ) : S.pins.filter( ( x ) => x !== note.id );
		}
		const next = Object.assign( {}, S.notes.get( note.id ) || {}, note );
		delete next.content;
		S.notes.set( note.id, next );
		if ( S.current && S.current.id === note.id ) {
			Object.assign( S.current.note, note, { content: S.current.note.content } );
		}
	}

	/* Skeleton ----------------------------------------------------------------------------- */

	mount.innerHTML =
		'<div class="nf-app" data-pane="list">' +
		'<aside class="nf-sidebar"></aside>' +
		'<section class="nf-list-pane" aria-label="' + esc( __( 'Notes', 'noteflow' ) ) + '">' +
		'<header class="nf-list-head"></header>' +
		'<div class="nf-search">' + icon( 'search', 15 ) +
		'<input type="search" class="nf-search-input" placeholder="' + esc( __( 'Search all notes', 'noteflow' ) ) + '" aria-label="' + esc( __( 'Search all notes', 'noteflow' ) ) + '" autocomplete="off" spellcheck="false"></div>' +
		'<div class="nf-list-notice"></div>' +
		'<div class="nf-list" role="listbox" tabindex="0" aria-label="' + esc( __( 'Notes', 'noteflow' ) ) + '"></div>' +
		'</section>' +
		'<main class="nf-editor-pane">' +
		'<header class="nf-toolbar" role="toolbar" aria-label="' + esc( __( 'Note tools', 'noteflow' ) ) + '"></header>' +
		'<div class="nf-banners" aria-live="polite"></div>' +
		'<div class="nf-editor-body">' +
		'<div class="nf-scroll">' +
		'<article class="nf-note" hidden>' +
		'<p class="nf-note-meta"></p>' +
		'<textarea class="nf-title" rows="1" placeholder="' + esc( __( 'Title', 'noteflow' ) ) + '" aria-label="' + esc( __( 'Title', 'noteflow' ) ) + '"></textarea>' +
		'<div class="nf-chips" hidden></div>' +
		'<div class="nf-body"></div>' +
		'</article>' +
		'<div class="nf-placeholder"></div>' +
		'</div>' +
		'<aside class="nf-activity" hidden>' +
		'<div class="nf-activity-head"></div>' +
		'<div class="nf-activity-body"></div>' +
		'<form class="nf-comment-form" hidden>' +
		'<ul class="nf-mention-list" role="listbox" hidden></ul>' +
		'<textarea rows="2" placeholder="' + esc( __( 'Add a comment. Type @ to mention someone.', 'noteflow' ) ) + '" aria-label="' + esc( __( 'Add a comment', 'noteflow' ) ) + '"></textarea>' +
		'<button type="submit" class="nf-button is-primary is-small">' + esc( __( 'Send', 'noteflow' ) ) + '</button>' +
		'</form>' +
		'</aside>' +
		'</div>' +
		'</main>' +
		'<div class="nf-layer"></div>' +
		'</div>';

	const $ = ( selector ) => mount.querySelector( selector );
	const app = $( '.nf-app' );
	const sidebarEl = $( '.nf-sidebar' );
	const listHead = $( '.nf-list-head' );
	const listEl = $( '.nf-list' );
	const noticeEl = $( '.nf-list-notice' );
	const searchInput = $( '.nf-search-input' );
	const toolbarEl = $( '.nf-toolbar' );
	const bannersEl = $( '.nf-banners' );
	const noteEl = $( '.nf-note' );
	const metaEl = $( '.nf-note-meta' );
	const titleEl = $( '.nf-title' );
	const chipsEl = $( '.nf-chips' );
	const placeholderEl = $( '.nf-placeholder' );
	const scrollEl = $( '.nf-scroll' );
	const activityEl = $( '.nf-activity' );
	const activityHead = $( '.nf-activity-head' );
	const activityBody = $( '.nf-activity-body' );
	const commentForm = $( '.nf-comment-form' );
	const commentInput = commentForm.querySelector( 'textarea' );
	const mentionList = commentForm.querySelector( '.nf-mention-list' );

	UI.setLayer( $( '.nf-layer' ) );

	const editor = new window.NoteFlowEditor( $( '.nf-body' ), {
		onChange: onEdit,
		onSelection: updateFormatState,
		onUpload: uploadImage,
		onLink: openLinkEditor,
		onExitStart: () => {
			titleEl.focus();
			titleEl.setSelectionRange( titleEl.value.length, titleEl.value.length );
		},
		onLinkQuery: ( q ) => linkSuggest.query( q ),
		onLinkKey: ( e ) => linkSuggest.key( e ),
		onOpenLink: openInternalLink,
	} );
	editor.root.setAttribute( 'aria-label', __( 'Note', 'noteflow' ) );
	editor.root.dataset.placeholder = __( 'Start writing…', 'noteflow' );

	/* Theme and size ----------------------------------------------------------------------- */

	const darkQuery = window.matchMedia( '(prefers-color-scheme: dark)' );

	const ACCENTS = [
		[ 'amber', __( 'Amber', 'noteflow' ), '#f5bd1f' ],
		[ 'blue', __( 'Blue', 'noteflow' ), '#2f7cf6' ],
		[ 'green', __( 'Green', 'noteflow' ), '#1f9d55' ],
		[ 'purple', __( 'Purple', 'noteflow' ), '#7c4dff' ],
		[ 'rose', __( 'Rose', 'noteflow' ), '#e5484d' ],
	];

	function applyTheme() {
		const theme = S.prefs.theme === 'auto' ? ( darkQuery.matches ? 'dark' : 'light' ) : S.prefs.theme;
		app.dataset.theme = theme === 'dark' ? 'dark' : 'light';
		app.dataset.accent = ACCENTS.some( ( a ) => a[ 0 ] === S.prefs.accent ) ? S.prefs.accent : 'amber';
	}
	darkQuery.addEventListener( 'change', applyTheme );

	function fitHeight() {
		const top = mount.getBoundingClientRect().top + window.scrollY;
		mount.style.height = Math.max( 460, window.innerHeight - top ) + 'px';
	}
	window.addEventListener( 'resize', debounce( fitHeight, 50 ) );

	/* What to show ----------------------------------------------------------------------- */

	function counts() {
		const c = { all: 0, shared: 0, reminders: 0, notes: 0, trash: 0, folders: {} };
		S.notes.forEach( ( n ) => {
			if ( n.status === 'trash' ) {
				c.trash++;
				return;
			}
			c.all++;
			if ( isShared( n ) ) {
				c.shared++;
			}
			if ( n.reminder && ! n.reminded ) {
				c.reminders++;
			}
			const folder = folderOf( n );
			if ( folder ) {
				c.folders[ folder ] = ( c.folders[ folder ] || 0 ) + 1;
			} else {
				c.notes++;
			}
		} );
		return c;
	}

	function allTags() {
		const freq = new Map();
		S.notes.forEach( ( n ) => {
			if ( n.status !== 'trash' ) {
				( n.tags || [] ).forEach( ( t ) => freq.set( t, ( freq.get( t ) || 0 ) + 1 ) );
			}
		} );
		return Array.from( freq.entries() )
			.sort( ( a, b ) => b[ 1 ] - a[ 1 ] || a[ 0 ].localeCompare( b[ 0 ] ) )
			.slice( 0, 40 )
			.map( ( entry ) => entry[ 0 ] );
	}

	function viewLabel( view ) {
		if ( view.indexOf( 'folder:' ) === 0 ) {
			return folderName( view.slice( 7 ) );
		}
		if ( view.indexOf( 'tag:' ) === 0 ) {
			return '#' + view.slice( 4 );
		}
		return (
			{
				all: __( 'All Notes', 'noteflow' ),
				shared: __( 'Shared', 'noteflow' ),
				reminders: __( 'Reminders', 'noteflow' ),
				notes: __( 'Notes', 'noteflow' ),
				trash: __( 'Recently Deleted', 'noteflow' ),
			}[ view ] || ''
		);
	}

	function inView( n ) {
		if ( S.view === 'trash' ) {
			return n.status === 'trash';
		}
		if ( n.status === 'trash' ) {
			return false;
		}
		if ( S.search ) {
			return true;
		}
		if ( S.view === 'all' ) {
			return true;
		}
		if ( S.view === 'shared' ) {
			return isShared( n );
		}
		if ( S.view === 'reminders' ) {
			return n.reminder > 0;
		}
		if ( S.view === 'notes' ) {
			return ! folderOf( n );
		}
		if ( S.view.indexOf( 'folder:' ) === 0 ) {
			return folderOf( n ) === S.view.slice( 7 );
		}
		if ( S.view.indexOf( 'tag:' ) === 0 ) {
			return ( n.tags || [] ).includes( S.view.slice( 4 ) );
		}
		return true;
	}

	function matchesSearch( n ) {
		if ( ! S.search ) {
			return true;
		}
		if ( S.results && S.results.has( n.id ) ) {
			return true;
		}
		const haystack = ( n.title + ' ' + n.excerpt + ' ' + ( n.tags || [] ).map( ( t ) => '#' + t ).join( ' ' ) ).toLowerCase();
		return S.search
			.toLowerCase()
			.split( /\s+/ )
			.every( ( word ) => haystack.includes( word ) );
	}

	const sortDate = ( n ) => ( S.prefs.sort === 'created' ? n.created : n.modified );

	function visible() {
		const notes = Array.from( S.notes.values() ).filter( ( n ) => inView( n ) && matchesSearch( n ) );
		if ( S.view === 'reminders' && ! S.search ) {
			return notes.sort( ( a, b ) => Number( a.reminded ) - Number( b.reminded ) || a.reminder - b.reminder );
		}
		if ( S.prefs.sort === 'title' ) {
			return notes.sort( ( a, b ) => noteTitle( a ).localeCompare( noteTitle( b ), locale, { sensitivity: 'base', numeric: true } ) );
		}
		return notes.sort( ( a, b ) => sortDate( b ) - sortDate( a ) || b.id - a.id );
	}

	/* Sidebar ------------------------------------------------------------------------------ */

	function sideItem( view, iconName, label, count, attrs ) {
		const active = S.view === view && ! S.search;
		return (
			'<button type="button" class="nf-side-item' + ( active ? ' is-active' : '' ) + '" data-view="' + esc( view ) + '"' + ( active ? ' aria-current="page"' : '' ) + ' ' + ( attrs || '' ) + '>' +
			'<span class="nf-side-icon">' + icon( iconName ) + '</span>' +
			'<span class="nf-side-label">' + esc( label ) + '</span>' +
			'<span class="nf-side-count">' + ( count ? count : '' ) + '</span>' +
			'</button>'
		);
	}

	/** The review request, at the top of the notes list. */
	function reviewCard() {
		return (
			'<div class="nf-notice nf-review-card">' +
			'<span class="nf-review-stars" aria-hidden="true">★★★★★</span>' +
			'<div><strong>' + esc( __( 'Enjoying NoteFlow?', 'noteflow' ) ) + '</strong>' +
			'<p>' + esc( __( 'A quick review on WordPress.org takes a minute and helps other teams find NoteFlow. Thank you!', 'noteflow' ) ) + '</p>' +
			'<div class="nf-review-actions">' +
			'<a class="nf-button is-small is-primary" href="' + esc( data.urls.review ) + '" target="_blank" rel="noopener noreferrer" data-action="review">' + esc( __( 'Leave a Review', 'noteflow' ) ) + '</a>' +
			'<button type="button" class="nf-button is-small" data-action="review-later">' + esc( __( 'Maybe Later', 'noteflow' ) ) + '</button>' +
			'<button type="button" class="nf-button is-small is-plain" data-action="review-done">' + esc( __( 'I Already Did', 'noteflow' ) ) + '</button>' +
			'</div></div></div>'
		);
	}

	function renderSidebar() {
		const c = counts();
		const unread = S.notifications.unread || 0;
		const tags = allTags();
		const bellLabel = unread
			? /* translators: %d: number of notifications. */ sprintf( _n( '%d unread notification', '%d unread notifications', unread, 'noteflow' ), unread )
			: __( 'Notifications', 'noteflow' );

		sidebarEl.innerHTML =
			'<div class="nf-side-head">' +
			'<div class="nf-brand"><img src="' + esc( data.urls.icon ) + '" width="24" height="24" alt=""><span>NoteFlow</span></div>' +
			'<button type="button" class="nf-icon-button nf-bell" data-action="notifications" aria-label="' + esc( bellLabel ) + '" title="' + esc( bellLabel ) + '" aria-haspopup="dialog">' + icon( 'bell' ) +
			( unread ? '<span class="nf-badge">' + ( unread > 9 ? '9+' : unread ) + '</span>' : '' ) + '</button>' +
			'</div>' +
			'<nav class="nf-side-scroll" aria-label="' + esc( __( 'Folders', 'noteflow' ) ) + '">' +
			'<div class="nf-side-group">' +
			sideItem( 'all', 'notes', __( 'All Notes', 'noteflow' ), c.all ) +
			( settings.sharing ? sideItem( 'shared', 'shared', __( 'Shared', 'noteflow' ), c.shared ) : '' ) +
			( modules.reminders ? sideItem( 'reminders', 'clock', __( 'Reminders', 'noteflow' ), c.reminders ) : '' ) +
			'</div>' +
			'<div class="nf-side-group">' +
			'<div class="nf-side-title">' + esc( __( 'Folders', 'noteflow' ) ) + '</div>' +
			sideItem( 'notes', 'folder', __( 'Notes', 'noteflow' ), c.notes, 'data-drop=""' ) +
			S.folders.map( ( f ) => sideItem( 'folder:' + f.id, 'folder', f.name, c.folders[ f.id ], 'data-drop="' + esc( f.id ) + '" data-folder="' + esc( f.id ) + '"' ) ).join( '' ) +
			sideItem( 'trash', 'trash', __( 'Recently Deleted', 'noteflow' ), c.trash ) +
			'</div>' +
			( tags.length
				? '<div class="nf-side-group"><div class="nf-side-title">' + esc( __( 'Tags', 'noteflow' ) ) + '</div><div class="nf-tag-cloud">' +
				  tags.map( ( t ) => '<button type="button" class="nf-tag' + ( S.view === 'tag:' + t && ! S.search ? ' is-active' : '' ) + '" data-view="tag:' + esc( t ) + '">#' + esc( t ) + '</button>' ).join( '' ) +
				  '</div></div>'
				: '' ) +
			'</nav>' +
			'<div class="nf-side-foot">' +
			'<div class="nf-side-foot-row">' +
			'<button type="button" class="nf-side-foot-btn" data-action="new-folder">' + icon( 'folderPlus', 17 ) + '<span>' + esc( __( 'New Folder', 'noteflow' ) ) + '</span></button>' +
			'<button type="button" class="nf-icon-button" data-action="prefs" aria-label="' + esc( __( 'Preferences', 'noteflow' ) ) + '" title="' + esc( __( 'Preferences', 'noteflow' ) ) + '" aria-haspopup="dialog">' + icon( 'sliders' ) + '</button>' +
			'</div></div>';
	}

	/* Notes list --------------------------------------------------------------------------- */

	function renderListHead( total ) {
		const label = S.search ? __( 'Results', 'noteflow' ) : viewLabel( S.view );
		/* translators: %d: number of notes. */
		const count = sprintf( _n( '%d note', '%d notes', total, 'noteflow' ), total );
		const gallery = S.prefs.view === 'gallery';
		const trash = S.view === 'trash' && ! S.search;
		const folder = S.view.indexOf( 'folder:' ) === 0 && ! S.search;

		let tools = '';
		if ( folder ) {
			tools += '<button type="button" class="nf-icon-button" data-action="folder-menu" aria-label="' + esc( __( 'Folder actions', 'noteflow' ) ) + '" title="' + esc( __( 'Folder actions', 'noteflow' ) ) + '" aria-haspopup="menu">' + icon( 'more' ) + '</button>';
		}
		tools += '<button type="button" class="nf-icon-button" data-action="toggle-layout" aria-label="' + esc( gallery ? __( 'View as list', 'noteflow' ) : __( 'View as gallery', 'noteflow' ) ) + '" title="' + esc( gallery ? __( 'View as list', 'noteflow' ) : __( 'View as gallery', 'noteflow' ) ) + '">' + icon( gallery ? 'listView' : 'gallery' ) + '</button>';
		tools += '<button type="button" class="nf-icon-button" data-action="sort-menu" aria-label="' + esc( __( 'Sort and group', 'noteflow' ) ) + '" title="' + esc( __( 'Sort and group', 'noteflow' ) ) + '" aria-haspopup="menu">' + icon( 'sort' ) + '</button>';
		if ( trash ) {
			tools += total ? '<button type="button" class="nf-button is-small" data-action="empty-trash">' + esc( __( 'Delete All', 'noteflow' ) ) + '</button>' : '';
		} else {
			tools +=
				'<span class="nf-compose">' +
				'<button type="button" class="nf-icon-button" data-action="compose" aria-label="' + esc( __( 'New Note', 'noteflow' ) ) + '" title="' + esc( __( 'New Note (N)', 'noteflow' ) ) + '">' + icon( 'compose' ) + '</button>' +
				( modules.templates ? '<button type="button" class="nf-icon-button nf-compose-more" data-action="templates" aria-label="' + esc( __( 'New note from a template', 'noteflow' ) ) + '" title="' + esc( __( 'New note from a template', 'noteflow' ) ) + '" aria-haspopup="menu">' + icon( 'chevronDown', 12 ) + '</button>' : '' ) +
				'</span>';
		}

		listHead.innerHTML =
			'<button type="button" class="nf-icon-button nf-only-mobile" data-action="show-sidebar" aria-label="' + esc( __( 'Folders', 'noteflow' ) ) + '">' + icon( 'chevronLeft' ) + '</button>' +
			'<button type="button" class="nf-icon-button nf-only-desktop" data-action="toggle-sidebar" aria-label="' + esc( S.prefs.collapsed ? __( 'Show folders', 'noteflow' ) : __( 'Hide folders', 'noteflow' ) ) + '" title="' + esc( S.prefs.collapsed ? __( 'Show folders', 'noteflow' ) : __( 'Hide folders', 'noteflow' ) ) + '">' + icon( 'sidebar' ) + '</button>' +
			'<div class="nf-list-title"><h2>' + esc( label ) + '</h2><span>' + esc( count ) + '</span></div>' +
			'<div class="nf-list-tools">' + tools + '</div>';
	}

	function highlight( text ) {
		let html = esc( text );
		S.search
			.split( /\s+/ )
			.filter( ( w ) => w.length > 1 )
			.forEach( ( word ) => {
				const safe = esc( word ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
				html = html.replace( new RegExp( '(' + safe + ')(?![^<]*>)', 'gi' ), '<mark>$1</mark>' );
			} );
		return html;
	}

	function daysLeft( n ) {
		const days = settings.trashDays || 30;
		const left = Math.max( 0, days - Math.floor( ( Date.now() / 1000 - ( n.trashed || n.modified ) ) / 86400 ) );
		/* translators: %d: number of days. */
		return sprintf( _n( '%d day left', '%d days left', left, 'noteflow' ), left );
	}

	function rowMeta( n ) {
		const bits = [];
		const multi = S.search || [ 'all', 'shared', 'reminders' ].includes( S.view ) || S.view.indexOf( 'tag:' ) === 0;

		if ( n.role !== 'owner' ) {
			bits.push( '<span class="nf-meta-owner">' + icon( 'shared', 13 ) + esc( person( n.owner ).name ) + '</span>' );
		} else if ( multi && S.view !== 'trash' ) {
			bits.push( '<span>' + icon( 'folder', 13 ) + esc( folderName( folderOf( n ) ) ) + '</span>' );
		}
		if ( n.role === 'owner' && n.shared ) {
			bits.push( '<span class="nf-meta-shared" title="' + esc( __( 'Shared', 'noteflow' ) ) + '">' + icon( 'shared', 13 ) + ( multi ? '' : esc( __( 'Shared', 'noteflow' ) ) ) + '</span>' );
		}
		if ( n.checklist && n.checklist[ 1 ] ) {
			bits.push( '<span class="nf-meta-check' + ( n.checklist[ 0 ] === n.checklist[ 1 ] ? ' is-done' : '' ) + '">' + icon( 'checklist', 13 ) + n.checklist[ 0 ] + '/' + n.checklist[ 1 ] + '</span>' );
		}
		if ( n.reminder && modules.reminders ) {
			const due = ! n.reminded && n.reminder * 1000 < Date.now() + 3600000;
			bits.push( '<span class="nf-meta-reminder' + ( n.reminded ? ' is-past' : due ? ' is-due' : '' ) + '">' + icon( 'clock', 13 ) + esc( UI.reminderLabel( n.reminder ) ) + '</span>' );
		}
		if ( n.comments && settings.comments ) {
			bits.push( '<span>' + icon( 'comment', 13 ) + n.comments + '</span>' );
		}
		return bits.join( '' );
	}

	function dot( n ) {
		return n.color ? '<span class="nf-dot" style="--dot:' + esc( n.color ) + '"></span>' : '';
	}

	function row( n ) {
		const selected = n.id === S.selected;
		const date = n.status === 'trash' ? daysLeft( n ) : UI.listDate( sortDate( n ) );
		const snippet = S.search && S.results && S.results.get( n.id );
		const excerpt = snippet ? highlight( snippet ) : S.search ? highlight( n.excerpt ) : esc( n.excerpt );
		const meta = rowMeta( n );
		return (
			'<div class="nf-row' + ( selected ? ' is-selected' : '' ) + '" role="option" id="nf-note-' + n.id + '" aria-selected="' + selected + '" data-id="' + n.id + '" draggable="true">' +
			'<div class="nf-row-main">' +
			'<div class="nf-row-title">' + dot( n ) + '<span class="nf-row-text">' + ( S.search ? highlight( noteTitle( n ) ) : esc( noteTitle( n ) ) ) + '</span></div>' +
			'<div class="nf-row-sub"><span class="nf-row-date">' + esc( date ) + '</span><span class="nf-row-excerpt">' + ( excerpt || esc( __( 'No additional text', 'noteflow' ) ) ) + '</span></div>' +
			( meta ? '<div class="nf-row-meta">' + meta + '</div>' : '' ) +
			'</div>' +
			( n.thumb ? '<img class="nf-row-thumb" src="' + esc( n.thumb ) + '" alt="" loading="lazy">' : '' ) +
			'</div>'
		);
	}

	function card( n ) {
		const selected = n.id === S.selected;
		return (
			'<div class="nf-card' + ( selected ? ' is-selected' : '' ) + '" role="option" id="nf-note-' + n.id + '" aria-selected="' + selected + '" data-id="' + n.id + '" draggable="true">' +
			'<div class="nf-card-paper">' +
			( n.thumb
				? '<img src="' + esc( n.thumb ) + '" alt="" loading="lazy">'
				: '<div class="nf-card-text"><strong>' + esc( noteTitle( n ) ) + '</strong><span>' + esc( n.excerpt ) + '</span></div>' ) +
			( n.checklist && n.checklist[ 1 ] ? '<span class="nf-card-badge">' + icon( 'checklist', 12 ) + n.checklist[ 0 ] + '/' + n.checklist[ 1 ] + '</span>' : '' ) +
			'</div>' +
			'<div class="nf-card-title">' + dot( n ) + '<span>' + esc( noteTitle( n ) ) + '</span></div>' +
			'<div class="nf-card-date">' + esc( n.status === 'trash' ? daysLeft( n ) : UI.listDate( sortDate( n ) ) ) + ( isShared( n ) ? ' ' + icon( 'shared', 12 ) : '' ) + '</div>' +
			'</div>'
		);
	}

	function emptyList() {
		let title = __( 'No Notes', 'noteflow' );
		let text = __( 'Notes you create in this folder show up here.', 'noteflow' );
		let iconName = 'notes';
		let button = true;

		if ( S.search ) {
			title = __( 'No Results', 'noteflow' );
			/* translators: %s: search terms. */
			text = sprintf( __( 'No notes match “%s”.', 'noteflow' ), S.search );
			iconName = 'search';
			button = false;
		} else if ( S.view === 'trash' ) {
			title = __( 'Nothing Deleted', 'noteflow' );
			/* translators: %d: number of days. */
			text = settings.trashDays ? sprintf( __( 'Deleted notes stay here for %d days before they are removed for good.', 'noteflow' ), settings.trashDays ) : __( 'This site deletes notes right away.', 'noteflow' );
			iconName = 'trash';
			button = false;
		} else if ( S.view === 'shared' ) {
			title = __( 'No Shared Notes', 'noteflow' );
			text = __( 'Notes you share, and notes others share with you, show up here.', 'noteflow' );
			iconName = 'shared';
			button = false;
		} else if ( S.view === 'reminders' ) {
			title = __( 'No Reminders', 'noteflow' );
			text = __( 'Add a reminder to any note from its More menu.', 'noteflow' );
			iconName = 'clock';
			button = false;
		} else if ( S.view === 'all' && ! S.notes.size ) {
			text = __( 'Write your first note. It stays private until you share it.', 'noteflow' );
		}

		return (
			'<div class="nf-empty-list">' + icon( iconName, 30 ) + '<p>' + esc( title ) + '</p><span>' + esc( text ) + '</span>' +
			( button ? '<button type="button" class="nf-button is-small" data-action="compose">' + icon( 'compose', 15 ) + esc( __( 'New Note', 'noteflow' ) ) + '</button>' : '' ) +
			'</div>'
		);
	}

	function renderList() {
		const notes = visible();
		const gallery = S.prefs.view === 'gallery';
		renderListHead( notes.length );
		app.classList.toggle( 'is-gallery', gallery );

		if ( ! notes.length ) {
			listEl.innerHTML = emptyList();
			return;
		}

		const scrollTop = listEl.scrollTop;
		const noPins = S.view === 'trash' || S.search || S.view === 'reminders';
		const pinned = noPins ? [] : notes.filter( ( n ) => isPinned( n.id ) );
		const rest = notes.filter( ( n ) => ! pinned.includes( n ) );
		const render = ( items ) => ( gallery ? '<div class="nf-grid">' + items.map( card ).join( '' ) + '</div>' : items.map( row ).join( '' ) );
		const section = ( label, items ) =>
			'<div class="nf-section" role="group"' + ( label ? ' aria-label="' + esc( label ) + '"' : '' ) + '>' +
			( label ? '<h3 class="nf-section-title">' + ( label === __( 'Pinned', 'noteflow' ) ? icon( 'pin', 13 ) : '' ) + esc( label ) + '</h3>' : '' ) +
			render( items ) +
			'</div>';

		let html = '';
		if ( pinned.length ) {
			html += section( __( 'Pinned', 'noteflow' ), pinned );
		}

		if ( S.view === 'reminders' && ! S.search ) {
			const upcoming = rest.filter( ( n ) => ! n.reminded );
			const past = rest.filter( ( n ) => n.reminded );
			html += upcoming.length ? section( __( 'Upcoming', 'noteflow' ), upcoming ) : '';
			html += past.length ? section( __( 'Past', 'noteflow' ), past ) : '';
		} else if ( S.prefs.group && S.prefs.sort !== 'title' && ! S.search && S.view !== 'trash' ) {
			const groups = [];
			rest.forEach( ( n ) => {
				const [ key, label ] = UI.dateGroup( sortDate( n ) );
				const last = groups[ groups.length - 1 ];
				if ( last && last.key === key ) {
					last.items.push( n );
				} else {
					groups.push( { key, label, items: [ n ] } );
				}
			} );
			groups.forEach( ( g ) => ( html += section( g.label, g.items ) ) );
		} else if ( rest.length ) {
			html += section( pinned.length ? __( 'Notes', 'noteflow' ) : '', rest );
		}

		listEl.innerHTML = html;
		listEl.scrollTop = scrollTop;
		if ( S.selected ) {
			listEl.setAttribute( 'aria-activedescendant', 'nf-note-' + S.selected );
		}
	}

	function renderNotices() {
		let html = '';
		if ( data.notices.upgrade && ! S.upgradeDismissed ) {
			html =
				'<div class="nf-notice">' + icon( 'lock', 16 ) +
				'<div><strong>' + esc( __( 'Welcome to NoteFlow 2.0', 'noteflow' ) ) + '</strong>' +
				'<p>' + esc( __( 'New notes are private until you share them. Notes from before this update are still shared with everyone, as they were. Change that for any note with the Share button.', 'noteflow' ) ) + '</p>' +
				'<button type="button" class="nf-button is-small" data-action="dismiss-upgrade">' + esc( __( 'Got It', 'noteflow' ) ) + '</button></div></div>';
		} else if ( data.notices.review && ! S.reviewDismissed && S.view !== 'trash' ) {
			html = reviewCard();
		} else if ( S.view === 'trash' && ! S.search && settings.trashDays ) {
			/* translators: %d: number of days. */
			html = '<p class="nf-list-hint">' + esc( sprintf( __( 'Notes are deleted for good after %d days.', 'noteflow' ), settings.trashDays ) ) + '</p>';
		}
		noticeEl.innerHTML = html;
	}

	/* Editor chrome ------------------------------------------------------------------------- */

	function tool( action, iconName, label, attrs ) {
		const inner = iconName === 'Aa' ? '<span class="nf-aa" aria-hidden="true">Aa</span>' : icon( iconName );
		return '<button type="button" class="nf-tool" data-action="' + action + '" aria-label="' + esc( label ) + '" title="' + esc( label ) + '" ' + ( attrs || '' ) + '>' + inner + '</button>';
	}

	function saveLabel() {
		return (
			{
				saving: __( 'Saving…', 'noteflow' ),
				saved: __( 'Saved', 'noteflow' ),
				error: __( 'Not saved yet. Retrying…', 'noteflow' ),
				offline: __( 'Offline. Will retry…', 'noteflow' ),
			}[ S.saveState ] || ''
		);
	}

	function setSaveState( state ) {
		S.saveState = state;
		const el = toolbarEl.querySelector( '.nf-save-state' );
		if ( el ) {
			el.dataset.state = state;
			el.textContent = saveLabel();
		}
		clearTimeout( setSaveState.timer );
		if ( state === 'saved' ) {
			setSaveState.timer = setTimeout( () => S.saveState === 'saved' && setSaveState( '' ), 1800 );
		}
	}

	function renderToolbar() {
		const cur = S.current;
		const n = cur ? cur.note : null;
		const editing = !! ( cur && ! cur.readOnly && ! S.preview );
		let html = '<button type="button" class="nf-tool nf-back" data-action="back" aria-label="' + esc( __( 'Back to notes', 'noteflow' ) ) + '">' + icon( 'chevronLeft' ) + '</button>';

		if ( n && editing ) {
			html +=
				'<div class="nf-tool-group nf-format">' +
				tool( 'format', 'Aa', __( 'Text styles', 'noteflow' ), 'aria-haspopup="menu"' ) +
				tool( 'checklist', 'checklist', __( 'Checklist', 'noteflow' ) + ' (' + MOD + SHIFT + 'L)' ) +
				tool( 'table', 'table', __( 'Table', 'noteflow' ), 'aria-haspopup="menu"' ) +
				( me.canUpload ? tool( 'image', 'image', __( 'Add image', 'noteflow' ) ) : '' ) +
				tool( 'link', 'link', __( 'Link', 'noteflow' ) + ' (' + MOD + 'K)' ) +
				'</div>';
		}
		html += '<div class="nf-tool-spacer"></div>';

		if ( n ) {
			html += '<span class="nf-save-state" data-state="' + esc( S.saveState ) + '" aria-live="polite">' + esc( saveLabel() ) + '</span>';
			html += '<div class="nf-presence" aria-live="polite"></div>';
			if ( settings.sharing && n.status !== 'trash' && ! cur.removed ) {
				html += '<button type="button" class="nf-tool nf-share-button' + ( n.shared || n.role !== 'owner' ? ' is-shared' : '' ) + '" data-action="share" aria-haspopup="dialog">' + icon( isShared( n ) ? 'shared' : 'userPlus' ) + '<span>' + esc( __( 'Share', 'noteflow' ) ) + '</span></button>';
			}
			if ( n.status !== 'trash' && ! cur.removed ) {
				const label = settings.comments ? __( 'Comments and history', 'noteflow' ) : __( 'Version history', 'noteflow' );
				html +=
					'<button type="button" class="nf-tool' + ( S.activity ? ' is-active' : '' ) + '" data-action="activity" aria-label="' + esc( label ) + '" title="' + esc( label ) + '" aria-pressed="' + ( S.activity ? 'true' : 'false' ) + '">' +
					icon( settings.comments ? 'comment' : 'history' ) +
					( settings.comments && n.comments ? '<span class="nf-tool-badge">' + n.comments + '</span>' : '' ) +
					'</button>';
			}
			html += tool( 'more', 'more', __( 'More actions', 'noteflow' ), 'aria-haspopup="menu"' );
		}

		toolbarEl.innerHTML = html;
		renderPresence();
		updateFormatState( editor.state() );
	}

	function updateFormatState( state ) {
		const check = toolbarEl.querySelector( '[data-action="checklist"]' );
		if ( check ) {
			check.classList.toggle( 'is-active', !! state && state.list === 'check' );
		}
		const table = toolbarEl.querySelector( '[data-action="table"]' );
		if ( table ) {
			table.classList.toggle( 'is-active', !! state && state.table );
		}
		const link = toolbarEl.querySelector( '[data-action="link"]' );
		if ( link ) {
			link.classList.toggle( 'is-active', !! state && !! state.link );
		}
	}

	function renderPresence() {
		const el = toolbarEl.querySelector( '.nf-presence' );
		if ( ! el || ! S.current ) {
			return;
		}
		const others = S.current.presence || [];
		el.innerHTML =
			others
				.slice( 0, 4 )
				.map( ( p ) => {
					const who = person( p.id );
					/* translators: %s: person's name. */
					const label = sprintf( p.editing ? __( '%s is editing', 'noteflow' ) : __( '%s is viewing', 'noteflow' ), who.name );
					return '<span class="nf-presence-item' + ( p.editing ? ' is-editing' : '' ) + '" title="' + esc( label ) + '" aria-label="' + esc( label ) + '" role="img">' + UI.avatar( who, 26 ) + '</span>';
				} )
				.join( '' ) + ( others.length > 4 ? '<span class="nf-presence-more">+' + ( others.length - 4 ) + '</span>' : '' );
	}

	function renderNoteMeta() {
		const cur = S.current;
		if ( ! cur ) {
			return;
		}
		const n = S.notes.get( cur.id ) || cur.note;
		let meta = UI.fullDate( n.modified );
		if ( isShared( n ) && n.modifiedBy && n.modifiedBy !== me.id ) {
			/* translators: 1: person's name, 2: date. */
			meta = sprintf( __( 'Edited by %1$s · %2$s', 'noteflow' ), person( n.modifiedBy ).name, meta );
		}
		metaEl.textContent = meta;

		const editing = canEdit( n ) && ! cur.readOnly && ! S.preview;
		const remove = ( action, label ) => ( editing ? '<button type="button" class="nf-chip-remove" data-action="' + action + '" aria-label="' + esc( label ) + '" title="' + esc( label ) + '">' + icon( 'close', 12 ) + '</button>' : '' );
		const chips = [];

		if ( n.role !== 'owner' ) {
			/* translators: %s: person's name. */
			chips.push( '<span class="nf-chip">' + UI.avatar( person( n.owner ), 16 ) + esc( sprintf( __( 'Shared by %s', 'noteflow' ), person( n.owner ).name ) ) + '</span>' );
		}
		if ( n.linked && modules.content_notes ) {
			const url = n.linked.edit || n.linked.view;
			const text = ( n.linked.type ? n.linked.type + ': ' : '' ) + n.linked.title;
			chips.push(
				'<span class="nf-chip nf-chip-link">' + icon( 'file', 14 ) +
				( url ? '<a href="' + esc( url ) + '" target="_blank" rel="noopener noreferrer">' + esc( text ) + '</a>' : '<span>' + esc( text ) + '</span>' ) +
				remove( 'remove-link', __( 'Detach from this post', 'noteflow' ) ) + '</span>'
			);
		}
		if ( n.reminder && modules.reminders ) {
			const due = ! n.reminded && n.reminder * 1000 < Date.now();
			chips.push(
				'<span class="nf-chip nf-chip-reminder' + ( n.reminded ? ' is-past' : due ? ' is-due' : '' ) + '">' +
				'<button type="button" data-action="reminder">' + icon( 'clock', 14 ) + esc( UI.reminderLabel( n.reminder ) ) + '</button>' +
				remove( 'remove-reminder', __( 'Remove reminder', 'noteflow' ) ) + '</span>'
			);
		}
		( n.tags || [] ).forEach( ( t ) => chips.push( '<button type="button" class="nf-chip nf-chip-tag" data-view="tag:' + esc( t ) + '">#' + esc( t ) + '</button>' ) );

		chipsEl.innerHTML = chips.join( '' );
		chipsEl.hidden = ! chips.length;
	}

	function banner( iconName, text, actions, className ) {
		return (
			'<div class="nf-banner ' + ( className || '' ) + '">' + icon( iconName, 16 ) + '<span class="nf-banner-text">' + esc( text ) + '</span>' +
			( actions || [] )
				.filter( Boolean )
				.map( ( a ) => '<button type="button" class="nf-button is-small' + ( a[ 2 ] ? ' is-primary' : '' ) + '" data-action="' + a[ 0 ] + '">' + esc( a[ 1 ] ) + '</button>' )
				.join( '' ) +
			'</div>'
		);
	}

	function renderBanners() {
		const cur = S.current;
		const out = [];
		if ( S.signedOut ) {
			out.push( banner( 'alert', __( 'You are signed out. Sign in again in another tab and your changes will save.', 'noteflow' ), [ [ 'reload', __( 'Reload', 'noteflow' ) ] ], 'is-warning' ) );
		}
		if ( cur ) {
			const n = cur.note;
			if ( S.preview ) {
				/* translators: 1: date, 2: person's name. */
				const text = sprintf( __( 'Version from %1$s, by %2$s.', 'noteflow' ), UI.fullDate( S.preview.time ), person( S.preview.author ).name );
				out.push( banner( 'history', text, [ ! cur.readOnly && [ 'preview-restore', __( 'Restore This Version', 'noteflow' ), true ], [ 'preview-close', __( 'Back to Current', 'noteflow' ) ] ], 'is-info' ) );
			} else if ( cur.removed ) {
				out.push( banner( 'lock', __( 'This note is no longer shared with you.', 'noteflow' ), [], 'is-warning' ) );
			} else if ( n.status === 'trash' ) {
				out.push( banner( 'trash', __( 'This note is in Recently Deleted. Recover it to edit it.', 'noteflow' ), [ n.role === 'owner' && [ 'recover', __( 'Recover', 'noteflow' ), true ] ] ) );
			} else if ( cur.conflict ) {
				/* translators: %s: person's name. */
				const text = sprintf( __( '%s changed the same lines while you were typing.', 'noteflow' ), person( cur.conflict.by ).name );
				out.push( banner( 'alert', text, [ [ 'conflict-mine', __( 'Keep Mine', 'noteflow' ), true ], [ 'conflict-theirs', __( 'Use Theirs', 'noteflow' ) ] ], 'is-warning' ) );
			} else if ( cur.readOnly ) {
				/* translators: %s: person's name. */
				out.push( banner( 'eye', sprintf( __( 'View only. %s shared this note with you, and you can comment on it.', 'noteflow' ), person( n.owner ).name ) ) );
			}
		}
		bannersEl.innerHTML = out.join( '' );
	}

	function renderPlaceholder() {
		const open = !! S.current || noteEl.classList.contains( 'is-loading' );
		noteEl.hidden = ! open;
		placeholderEl.hidden = open;
		if ( ! open ) {
			placeholderEl.innerHTML =
				'<div class="nf-placeholder-inner">' +
				'<img src="' + esc( data.urls.icon ) + '" width="64" height="64" alt="">' +
				'<p>' + esc( S.notes.size ? __( 'Pick a note, or start a new one.', 'noteflow' ) : __( 'Your notes live here.', 'noteflow' ) ) + '</p>' +
				'<button type="button" class="nf-button is-primary" data-action="compose">' + icon( 'compose', 16 ) + esc( __( 'New Note', 'noteflow' ) ) + '</button>' +
				/* translators: 1: key for a new note, 2: key for search, 3: key for shortcuts. */
				'<p class="nf-hint">' + sprintf( esc( __( 'Press %1$s for a new note, %2$s to search, %3$s for all shortcuts.', 'noteflow' ) ), '<kbd>N</kbd>', '<kbd>/</kbd>', '<kbd>?</kbd>' ) + '</p>' +
				'</div>';
		}
	}

	function applyPanes() {
		app.dataset.pane = S.pane;
		app.classList.toggle( 'is-collapsed', !! S.prefs.collapsed );
		app.classList.toggle( 'is-gallery-open', S.prefs.view === 'gallery' && S.galleryOpen );
		app.classList.toggle( 'has-activity', !! S.activity );
	}

	function renderAll() {
		renderSidebar();
		renderList();
		renderNotices();
		renderToolbar();
		renderBanners();
		renderNoteMeta();
		renderPlaceholder();
		applyPanes();
	}

	function updateUrl() {
		const url = new URL( window.location.href );
		if ( S.current ) {
			url.searchParams.set( 'note', S.current.id );
		} else {
			url.searchParams.delete( 'note' );
		}
		url.searchParams.delete( 'new' );
		if ( S.view !== 'all' && S.view.indexOf( 'tag:' ) !== 0 ) {
			url.searchParams.set( 'folder', S.view.replace( ':', '-' ) );
		} else {
			url.searchParams.delete( 'folder' );
		}
		window.history.replaceState( null, '', url.toString() );
	}

	function autosizeTitle() {
		titleEl.style.height = 'auto';
		titleEl.style.height = titleEl.scrollHeight + 'px';
	}

	/* Opening, creating and leaving notes ----------------------------------------------- */

	function showEditorPane() {
		if ( isMobile() ) {
			S.pane = 'editor';
		}
		if ( S.prefs.view === 'gallery' ) {
			S.galleryOpen = true;
		}
		applyPanes();
	}

	async function leaveCurrent() {
		const cur = S.current;
		if ( ! cur ) {
			return;
		}
		if ( S.preview ) {
			closePreview();
		}
		await flushSave();
		S.leftNote = cur.id;

		// A new note left empty is thrown away, as in most notes apps.
		if ( S.created.has( cur.id ) && ! titleEl.value.trim() && editor.isEmpty() ) {
			S.notes.delete( cur.id );
			api.del( '/notes/' + cur.id, { force: 1 } ).catch( () => {} );
		}
		S.created.delete( cur.id );
		S.current = null;
		S.comments = [];
		S.revisions = [];
	}

	function showLoading( summary ) {
		noteEl.classList.add( 'is-loading' );
		noteEl.hidden = false;
		placeholderEl.hidden = true;
		titleEl.value = summary && ! summary.untitled ? summary.title : '';
		titleEl.readOnly = true;
		autosizeTitle();
		editor.setContent( '' );
		editor.setReadOnly( true );
		metaEl.textContent = summary ? UI.fullDate( summary.modified ) : '';
		chipsEl.hidden = true;
		bannersEl.innerHTML = '';
	}

	let openToken = 0;

	async function openNote( id, options ) {
		options = options || {};
		if ( S.current && S.current.id === id && ! options.reload ) {
			showEditorPane();
			return;
		}
		const token = ++openToken;
		await leaveCurrent();
		if ( token !== openToken ) {
			return;
		}

		S.selected = id;
		showLoading( S.notes.get( id ) );
		renderList();
		renderToolbar();
		showEditorPane();

		try {
			const res = await api.get( '/notes/' + id );
			if ( token !== openToken ) {
				return;
			}
			Object.assign( S.people, res.people || {} );
			loadIntoEditor( res.note );
			if ( options.focus ) {
				editor.focus( 'end' );
			}
		} catch ( err ) {
			if ( token !== openToken ) {
				return;
			}
			noteEl.classList.remove( 'is-loading' );
			if ( err && err.code === 'noteflow_not_found' ) {
				S.notes.delete( id );
				S.selected = 0;
			}
			renderAll();
			failed( err );
		}
	}

	function loadIntoEditor( note, options ) {
		options = options || {};
		const readOnly = ! note.can.edit;

		S.current = {
			id: note.id,
			note,
			version: note.version,
			baseTitle: note.titleRaw,
			baseContent: '',
			changeSeq: 0,
			savedSeq: 0,
			lastTyped: 0,
			presence: [],
			readOnly,
			conflict: null,
			removed: false,
		};
		S.selected = note.id;

		noteEl.classList.remove( 'is-loading' );
		titleEl.value = note.titleRaw;
		titleEl.readOnly = readOnly;
		autosizeTitle();
		editor.setContent( note.content );
		editor.setReadOnly( readOnly );
		S.current.baseContent = editor.getContent();
		upsert( note );

		if ( ! options.keepActivity ) {
			S.comments = [];
			S.revisions = [];
		}
		if ( ! options.keepScroll ) {
			scrollEl.scrollTop = 0;
		}

		renderToolbar();
		renderBanners();
		renderNoteMeta();
		renderPlaceholder();
		renderList();
		if ( S.activity ) {
			renderActivity();
			loadActivity();
		}
		updateUrl();
		scheduleSync( 700 );
	}

	function selectNote( id ) {
		openNote( id );
	}

	let creating = false;

	async function newNote( template ) {
		if ( creating ) {
			return;
		}
		creating = true;
		try {
			await leaveCurrent();

			let folder = '';
			let content = template ? template.content : '';
			if ( S.view.indexOf( 'folder:' ) === 0 ) {
				folder = S.view.slice( 7 );
			} else if ( S.view.indexOf( 'tag:' ) === 0 && ! template ) {
				content = '<p><br></p><p>#' + esc( S.view.slice( 4 ) ) + '</p>';
			} else if ( [ 'trash', 'shared', 'reminders' ].includes( S.view ) ) {
				S.view = 'all';
			}
			if ( S.search ) {
				S.search = '';
				S.results = null;
				searchInput.value = '';
			}

			const res = await api.post( '/notes', { title: template ? template.title : '', content, folder } );
			Object.assign( S.people, res.people || {} );
			upsert( res.note );
			touch( res.note.id );
			if ( ! template ) {
				S.created.add( res.note.id );
			}

			renderSidebar();
			loadIntoEditor( res.note );
			showEditorPane();
			if ( template ) {
				focusTemplate();
			} else {
				titleEl.focus();
			}
		} catch ( err ) {
			failed( err );
		} finally {
			creating = false;
		}
	}

	/** In a new note from a template, start typing after a leading label or in the first empty line. */
	function focusTemplate() {
		editor.root.focus();
		const first = editor.root.firstElementChild;
		if ( first && /:\s*$/.test( first.textContent ) ) {
			editor.caretIn( first, true );
			return;
		}
		const empty = Array.from( editor.root.querySelectorAll( 'p,li,td,h1,h2,h3' ) ).find( ( el ) => ! el.textContent.trim() && ! el.querySelector( 'img' ) );
		if ( empty ) {
			editor.caretIn( empty );
		} else {
			editor.focus( 'end' );
		}
	}

	function openFirst() {
		if ( isMobile() || S.prefs.view === 'gallery' ) {
			return;
		}
		const first = visible()[ 0 ];
		if ( first ) {
			openNote( first.id );
		}
	}

	function setView( view ) {
		if ( S.search ) {
			S.search = '';
			S.results = null;
			searchInput.value = '';
		}
		S.view = view;
		S.pane = 'list';
		S.galleryOpen = false;
		renderSidebar();
		renderList();
		renderNotices();
		applyPanes();
		updateUrl();

		const notes = visible();
		if ( ! isMobile() && S.prefs.view === 'list' && notes.length && ! notes.some( ( n ) => n.id === S.selected ) ) {
			openNote( notes[ 0 ].id );
		}
	}

	async function goToNote( id ) {
		if ( ! S.notes.has( id ) ) {
			try {
				const res = await api.get( '/notes', { include: String( id ) } );
				Object.assign( S.people, res.people || {} );
				res.notes.forEach( upsert );
			} catch ( err ) {}
		}
		const n = S.notes.get( id );
		if ( ! n ) {
			UI.toast( __( 'That note is gone, or it is no longer shared with you.', 'noteflow' ), { error: true } );
			return;
		}
		if ( ! inView( n ) || S.search ) {
			S.search = '';
			S.results = null;
			searchInput.value = '';
			S.view = n.status === 'trash' ? 'trash' : 'all';
			renderSidebar();
			renderNotices();
		}
		S.pane = 'list';
		renderList();
		openNote( id );
		const el = listEl.querySelector( '[data-id="' + id + '"]' );
		if ( el ) {
			el.scrollIntoView( { block: 'nearest' } );
		}
	}

	/* Saving ------------------------------------------------------------------------------- */

	let saveTimer = null;
	let maxTimer = null;
	let saving = null;

	function scheduleSave( delay ) {
		clearTimeout( saveTimer );
		saveTimer = setTimeout( save, delay );
	}

	function onEdit() {
		const cur = S.current;
		if ( ! cur || cur.readOnly || S.preview ) {
			return;
		}
		cur.changeSeq++;
		cur.lastTyped = Date.now();
		scheduleSave( 800 );
		if ( ! maxTimer ) {
			maxTimer = setTimeout( save, 4000 );
		}
	}

	function save() {
		clearTimeout( saveTimer );
		clearTimeout( maxTimer );
		saveTimer = null;
		maxTimer = null;

		const cur = S.current;
		if ( ! cur || cur.readOnly || S.preview || cur.conflict || cur.removed ) {
			return Promise.resolve();
		}
		if ( saving ) {
			cur.saveAgain = true;
			return saving;
		}
		if ( cur.changeSeq === cur.savedSeq ) {
			return Promise.resolve();
		}

		const seq = cur.changeSeq;
		const sent = { title: titleEl.value, content: editor.getContent() };
		setSaveState( 'saving' );

		saving = api
			.post( '/notes/' + cur.id, { title: sent.title, content: sent.content, base_version: cur.version } )
			.then( ( res ) => {
				debug( 'saved', { from: cur.version, to: res.note.version, seq, changeSeq: cur.changeSeq } );
				cur.version = res.note.version;
				cur.baseTitle = sent.title;
				cur.baseContent = sent.content;
				cur.savedSeq = Math.max( cur.savedSeq, seq );
				S.created.delete( cur.id );
				S.signedOut = false;
				upsert( res.note );
				if ( S.current === cur ) {
					setSaveState( cur.changeSeq === cur.savedSeq ? 'saved' : 'saving' );
					renderNoteMeta();
					renderBanners();
				}
				renderList();
				renderSidebar();
			} )
			.catch( ( err ) => handleSaveError( cur, err, sent ) )
			.finally( () => {
				saving = null;
				if ( S.current === cur && ( cur.saveAgain || cur.changeSeq !== cur.savedSeq ) && ! cur.conflict && ! cur.retry ) {
					cur.saveAgain = false;
					scheduleSave( 250 );
				}
			} );
		return saving;
	}

	async function flushSave() {
		clearTimeout( saveTimer );
		clearTimeout( maxTimer );
		saveTimer = null;
		maxTimer = null;
		if ( saving ) {
			try {
				await saving;
			} catch ( e ) {}
		}
		const cur = S.current;
		if ( cur && cur.changeSeq !== cur.savedSeq && ! cur.readOnly && ! cur.conflict ) {
			try {
				await save();
			} catch ( e ) {}
		}
	}

	function handleSaveError( cur, err, sent ) {
		const code = err && err.code;
		if ( code === 'noteflow_conflict' && err.data && err.data.note ) {
			Object.assign( S.people, err.data.people || {} );
			resolveConflict( cur, err.data.note, sent );
			return;
		}
		if ( code === 'noteflow_not_found' || code === 'noteflow_read_only' || code === 'noteflow_trashed' ) {
			cur.readOnly = true;
			cur.removed = code === 'noteflow_not_found';
			if ( S.current === cur ) {
				editor.setReadOnly( true );
				titleEl.readOnly = true;
				setSaveState( '' );
				renderBanners();
				renderToolbar();
			}
			failed( err );
			return;
		}
		if ( code === 'noteflow_signed_out' || code === 'rest_cookie_invalid_nonce' || ( err && err.data && err.data.status === 401 ) ) {
			S.signedOut = true;
			renderBanners();
		}
		if ( S.current === cur ) {
			setSaveState( code === 'fetch_error' || navigator.onLine === false ? 'offline' : 'error' );
		}
		clearTimeout( cur.retry );
		cur.retry = setTimeout( () => {
			cur.retry = null;
			if ( S.current === cur ) {
				save();
			}
		}, 5000 );
	}

	function resolveConflict( cur, remote, sent ) {
		const base = cur.baseContent;
		const theirs = Merge.normalize( remote.content );
		const onScreen = S.current === cur;
		const mine = onScreen ? editor.getContent() : sent.content;
		const result = Merge.merge( base, mine, theirs );
		debug( 'conflict', { version: cur.version, remote: remote.version, base, mine, theirs, result } );
		let title = onScreen ? titleEl.value : sent.title;
		if ( title === cur.baseTitle ) {
			title = remote.titleRaw;
		}

		cur.version = remote.version;
		cur.baseContent = theirs;
		cur.baseTitle = remote.titleRaw;
		upsert( remote );

		if ( ! onScreen ) {
			// The note was closed meanwhile: save the merge quietly.
			api.post( '/notes/' + cur.id, { title, content: result.html, base_version: remote.version } )
				.then( ( res ) => upsert( res.note ) )
				.catch( () => {} );
			return;
		}

		if ( result.conflict ) {
			cur.conflict = { by: remote.modifiedBy, base, theirs, title: remote.titleRaw };
			setSaveState( '' );
			renderBanners();
			return;
		}

		if ( result.html !== mine ) {
			const caret = editor.root.contains( document.activeElement ) ? editor.getCaret() : null;
			editor.setContent( result.html );
			editor.setCaret( caret );
		}
		if ( titleEl.value !== title ) {
			titleEl.value = title;
			autosizeTitle();
		}
		if ( result.html === theirs && title === remote.titleRaw ) {
			cur.savedSeq = cur.changeSeq;
		} else {
			cur.changeSeq++;
			scheduleSave( 150 );
		}
		/* translators: %s: person's name. */
		UI.toast( sprintf( __( 'Merged in changes from %s.', 'noteflow' ), person( remote.modifiedBy ).name ) );
		renderNoteMeta();
		renderList();
	}

	function keepMine() {
		const cur = S.current;
		if ( ! cur || ! cur.conflict ) {
			return;
		}
		const conflict = cur.conflict;
		cur.conflict = null;
		// Keep their changes that don't clash with mine, and mine where they do.
		const merged = Merge.merge( conflict.base, editor.getContent(), conflict.theirs ).html;
		if ( merged !== editor.getContent() ) {
			const caret = editor.getCaret();
			editor.setContent( merged );
			editor.setCaret( caret );
		}
		cur.changeSeq++;
		renderBanners();
		save();
	}

	function useTheirs() {
		const cur = S.current;
		if ( ! cur || ! cur.conflict ) {
			return;
		}
		editor.setContent( cur.conflict.theirs );
		titleEl.value = cur.conflict.title;
		autosizeTitle();
		cur.conflict = null;
		cur.savedSeq = ++cur.changeSeq;
		renderBanners();
	}

	async function pullRemote( cur, force ) {
		if ( cur.pulling ) {
			return;
		}
		cur.pulling = true;
		try {
			const res = await api.get( '/notes/' + cur.id );
			Object.assign( S.people, res.people || {} );
			const remote = res.note;
			if ( S.current !== cur || S.preview ) {
				return;
			}
			if ( remote.version <= cur.version && ! force ) {
				return;
			}
			debug( 'pull', { local: cur.version, remote: remote.version, dirty: cur.changeSeq !== cur.savedSeq, saving: !! saving } );
			if ( saving || cur.changeSeq !== cur.savedSeq ) {
				// Unsaved edits here: the save will meet the new version and merge.
				scheduleSave( 0 );
				return;
			}

			const hadFocus = editor.root.contains( document.activeElement );
			const caret = hadFocus ? editor.getCaret() : null;
			editor.setContent( remote.content );
			if ( caret ) {
				editor.setCaret( caret );
			}
			if ( document.activeElement !== titleEl || titleEl.value === cur.baseTitle ) {
				const start = titleEl.selectionStart;
				titleEl.value = remote.titleRaw;
				autosizeTitle();
				if ( document.activeElement === titleEl ) {
					titleEl.setSelectionRange( start, start );
				}
			}

			const readOnly = ! remote.can.edit;
			cur.version = remote.version;
			cur.baseContent = editor.getContent();
			cur.baseTitle = remote.titleRaw;
			cur.note = remote;
			if ( readOnly !== cur.readOnly ) {
				cur.readOnly = readOnly;
				editor.setReadOnly( readOnly );
				titleEl.readOnly = readOnly;
				renderToolbar();
			}
			upsert( remote );
			renderNoteMeta();
			renderBanners();
			renderList();
		} catch ( err ) {
			// The next sync tries again.
		} finally {
			cur.pulling = false;
		}
	}

	/* Live sync -------------------------------------------------------------------------- */

	let syncTimer = null;
	let syncing = false;

	function scheduleSync( delay ) {
		clearTimeout( syncTimer );
		syncTimer = setTimeout( sync, delay );
	}

	async function sync() {
		clearTimeout( syncTimer );
		if ( syncing ) {
			return;
		}
		if ( document.hidden ) {
			scheduleSync( 30000 );
			return;
		}
		syncing = true;

		const cur = S.current;
		const body = {
			since: S.syncedAt,
			note: cur && ! cur.removed ? cur.id : 0,
			editing: !! ( cur && Date.now() - cur.lastTyped < 8000 ),
			left: S.leftNote || 0,
		};
		S.leftNote = 0;
		let others = 0;

		try {
			const res = await api.post( '/sync', body );
			S.syncedAt = res.now;
			if ( S.signedOut ) {
				S.signedOut = false;
				renderBanners();
			}
			Object.assign( S.people, res.people || {} );

			let changed = false;
			const ids = new Set( res.ids );
			S.notes.forEach( ( n, id ) => {
				const fresh = Date.now() - ( S.touched.get( id ) || 0 ) < 20000;
				if ( ! ids.has( id ) && ! fresh ) {
					S.notes.delete( id );
					changed = true;
				}
			} );
			( res.changed || [] ).forEach( ( n ) => {
				const known = S.notes.get( n.id );
				if ( ! known || known.version !== n.version || known.modified !== n.modified || known.shared !== n.shared || known.role !== n.role || known.status !== n.status ) {
					upsert( n );
					changed = true;
				}
			} );
			const unknown = res.ids.filter( ( id ) => ! S.notes.has( id ) );
			if ( unknown.length ) {
				const more = await api.get( '/notes', { include: unknown.slice( 0, 200 ).join( ',' ) } );
				Object.assign( S.people, more.people || {} );
				more.notes.forEach( upsert );
				changed = true;
			}

			if ( res.unread !== S.notifications.unread ) {
				const before = S.notifications.unread;
				S.notifications.unread = res.unread;
				if ( res.unread > before ) {
					refreshNotifications();
				}
				renderSidebar();
				updateMenuBubble();
			}

			if ( res.note && cur && S.current === cur && res.note.id === cur.id ) {
				if ( res.note.removed ) {
					cur.removed = true;
					cur.readOnly = true;
					editor.setReadOnly( true );
					titleEl.readOnly = true;
					renderBanners();
					renderToolbar();
				} else {
					cur.presence = res.note.presence || [];
					others = cur.presence.length;
					renderPresence();
					const roleChanged = res.note.role !== cur.note.role;
					if ( ( res.note.version > cur.version || roleChanged ) && ! S.preview ) {
						pullRemote( cur, roleChanged );
					}
					if ( res.note.comments !== cur.note.comments ) {
						cur.note.comments = res.note.comments;
						const summary = S.notes.get( cur.id );
						if ( summary ) {
							summary.comments = res.note.comments;
						}
						renderToolbar();
						if ( S.activity === 'comments' ) {
							loadActivity();
						}
					}
				}
			}

			if ( changed ) {
				renderSidebar();
				renderList();
				if ( S.current === cur && cur ) {
					renderNoteMeta();
				}
			}
		} catch ( err ) {
			if ( err && ( err.code === 'noteflow_signed_out' || ( err.data && err.data.status === 401 ) ) ) {
				S.signedOut = true;
				renderBanners();
			}
		} finally {
			syncing = false;
		}

		const shared = !! ( cur && S.current === cur && isShared( cur.note ) );
		scheduleSync( others ? 4000 : shared ? 10000 : 30000 );
	}

	async function refreshNotifications() {
		try {
			const res = await api.get( '/notifications' );
			Object.assign( S.people, res.people || {} );
			S.notifications = { items: res.items, unread: res.unread };
			renderSidebar();
			updateMenuBubble();
		} catch ( err ) {}
	}

	function updateMenuBubble() {
		const name = document.querySelector( '#toplevel_page_noteflow-notes .wp-menu-name' );
		if ( ! name ) {
			return;
		}
		let bubble = name.querySelector( '.awaiting-mod' );
		const unread = S.notifications.unread || 0;
		if ( ! unread ) {
			if ( bubble ) {
				bubble.remove();
			}
			return;
		}
		if ( ! bubble ) {
			bubble = document.createElement( 'span' );
			name.appendChild( document.createTextNode( ' ' ) );
			name.appendChild( bubble );
		}
		bubble.className = 'awaiting-mod count-' + unread;
		bubble.innerHTML = '<span class="pending-count">' + unread + '</span>';
	}

	/* Note actions ----------------------------------------------------------------------- */

	async function togglePin( id ) {
		const pinned = ! isPinned( id );
		S.pins = pinned ? [ id ].concat( S.pins.filter( ( x ) => x !== id ) ) : S.pins.filter( ( x ) => x !== id );
		renderList();
		try {
			const res = await api.post( '/notes/' + id + '/pin', { pinned } );
			S.pins = res.pins;
		} catch ( err ) {
			failed( err );
		}
		renderList();
	}

	async function moveTo( id, folder ) {
		const before = S.filed[ id ];
		if ( folder ) {
			S.filed[ id ] = folder;
		} else {
			delete S.filed[ id ];
		}
		renderSidebar();
		renderList();
		try {
			const res = await api.post( '/notes/' + id + '/folder', { folder } );
			S.filed = Object.assign( {}, res.filed );
			/* translators: %s: folder name. */
			UI.toast( sprintf( __( 'Moved to %s.', 'noteflow' ), folderName( folder ) ) );
		} catch ( err ) {
			if ( before ) {
				S.filed[ id ] = before;
			}
			failed( err );
		}
		renderSidebar();
		renderList();
	}

	async function newFolder( moveId ) {
		const name = await UI.askText( { title: __( 'New Folder', 'noteflow' ), label: __( 'Folder name', 'noteflow' ), confirm: __( 'Create', 'noteflow' ) } );
		if ( ! name ) {
			return;
		}
		try {
			const res = await api.post( '/folders', { name } );
			S.folders = res.folders;
			if ( moveId ) {
				await moveTo( moveId, res.folder.id );
			} else {
				setView( 'folder:' + res.folder.id );
			}
		} catch ( err ) {
			failed( err );
		}
	}

	async function renameFolder( id ) {
		const name = await UI.askText( { title: __( 'Rename Folder', 'noteflow' ), label: __( 'Folder name', 'noteflow' ), value: folderName( id ), confirm: __( 'Rename', 'noteflow' ) } );
		if ( ! name ) {
			return;
		}
		try {
			const res = await api.post( '/folders/' + id, { name } );
			S.folders = res.folders;
			renderSidebar();
			renderList();
		} catch ( err ) {
			failed( err );
		}
	}

	async function deleteFolder( id ) {
		const ok = await UI.confirm( {
			/* translators: %s: folder name. */
			title: sprintf( __( 'Delete “%s”?', 'noteflow' ), folderName( id ) ),
			message: __( 'The folder is deleted, but not its notes. They move to Notes.', 'noteflow' ),
			confirm: __( 'Delete Folder', 'noteflow' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		try {
			const res = await api.del( '/folders/' + id );
			S.folders = res.folders;
			S.filed = Object.assign( {}, res.filed );
			if ( S.view === 'folder:' + id ) {
				setView( 'notes' );
			} else {
				renderSidebar();
				renderList();
			}
		} catch ( err ) {
			failed( err );
		}
	}

	function neighbour( id ) {
		const ids = visible().map( ( n ) => n.id );
		const i = ids.indexOf( id );
		return i === -1 ? 0 : ids[ i + 1 ] || ids[ i - 1 ] || 0;
	}

	function closeEditor() {
		S.current = null;
		S.selected = 0;
		S.activity = '';
		activityEl.hidden = true;
		updateUrl();
	}

	async function trashNote( id ) {
		const n = S.notes.get( id );
		if ( ! n || n.role !== 'owner' ) {
			return;
		}
		if ( ! settings.trashDays ) {
			const ok = await UI.confirm( { title: __( 'Delete this note?', 'noteflow' ), message: __( 'This site deletes notes right away. This cannot be undone.', 'noteflow' ), confirm: __( 'Delete', 'noteflow' ), danger: true } );
			if ( ! ok ) {
				return;
			}
		}
		const isOpen = S.current && S.current.id === id;
		const next = neighbour( id );
		if ( isOpen ) {
			await flushSave();
		}
		try {
			const res = await api.del( '/notes/' + id );
			if ( res.deleted ) {
				S.notes.delete( id );
			} else {
				upsert( res.note );
			}
			S.created.delete( id );
			if ( isOpen ) {
				S.leftNote = id;
				closeEditor();
				if ( next && ! isMobile() ) {
					openNote( next );
				}
			}
			renderAll();
			if ( ! res.deleted ) {
				UI.toast( __( 'Moved to Recently Deleted.', 'noteflow' ), { action: { label: __( 'Undo', 'noteflow' ), fn: () => restoreNote( id, true ) } } );
			}
		} catch ( err ) {
			failed( err );
		}
	}

	async function restoreNote( id, reopen ) {
		try {
			const res = await api.post( '/notes/' + id + '/restore' );
			upsert( res.note );
			touch( id );
			if ( S.view === 'trash' && reopen ) {
				S.view = 'all';
			}
			renderAll();
			if ( reopen || ( S.current && S.current.id === id ) ) {
				openNote( id, { reload: true } );
			}
			UI.toast( __( 'Note recovered.', 'noteflow' ) );
		} catch ( err ) {
			failed( err );
		}
	}

	async function deleteForever( id ) {
		const ok = await UI.confirm( { title: __( 'Delete this note for good?', 'noteflow' ), message: __( 'You cannot undo this.', 'noteflow' ), confirm: __( 'Delete', 'noteflow' ), danger: true } );
		if ( ! ok ) {
			return;
		}
		try {
			await api.del( '/notes/' + id, { force: 1 } );
			S.notes.delete( id );
			if ( S.current && S.current.id === id ) {
				closeEditor();
			}
			renderAll();
		} catch ( err ) {
			failed( err );
		}
	}

	async function emptyTrash() {
		const count = Array.from( S.notes.values() ).filter( ( n ) => n.status === 'trash' ).length;
		const ok = await UI.confirm( {
			/* translators: %d: number of notes. */
			title: sprintf( _n( 'Delete %d note for good?', 'Delete %d notes for good?', count, 'noteflow' ), count ),
			message: __( 'You cannot undo this.', 'noteflow' ),
			confirm: __( 'Delete All', 'noteflow' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		try {
			const res = await api.del( '/trash' );
			res.deleted.forEach( ( id ) => S.notes.delete( id ) );
			if ( S.current && res.deleted.includes( S.current.id ) ) {
				closeEditor();
			}
			renderAll();
		} catch ( err ) {
			failed( err );
		}
	}

	async function duplicate( id ) {
		if ( S.current && S.current.id === id ) {
			await flushSave();
		}
		try {
			const res = await api.post( '/notes/' + id + '/duplicate' );
			Object.assign( S.people, res.people || {} );
			upsert( res.note );
			touch( res.note.id );
			renderAll();
			openNote( res.note.id );
			UI.toast( __( 'Note duplicated.', 'noteflow' ) );
		} catch ( err ) {
			failed( err );
		}
	}

	async function leaveNote( id ) {
		const ok = await UI.confirm( {
			title: __( 'Remove this note from your notes?', 'noteflow' ),
			message: __( 'You will lose access to it. The owner can share it with you again.', 'noteflow' ),
			confirm: __( 'Remove', 'noteflow' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		try {
			const res = await api.post( '/notes/' + id + '/leave' );
			if ( res.role ) {
				UI.toast( __( 'This note is shared with everyone, so it stays in your list.', 'noteflow' ) );
				return;
			}
			S.notes.delete( id );
			if ( S.current && S.current.id === id ) {
				closeEditor();
			}
			renderAll();
		} catch ( err ) {
			failed( err );
		}
	}

	function noteLink( id ) {
		const url = new URL( data.urls.app );
		url.searchParams.set( 'note', id );
		return url.toString();
	}

	function copyLink( id ) {
		const url = noteLink( id );
		const done = () => UI.toast( __( 'Link copied. Only people with access can open it.', 'noteflow' ) );
		if ( navigator.clipboard && window.isSecureContext ) {
			navigator.clipboard.writeText( url ).then( done, () => window.prompt( __( 'Copy this link:', 'noteflow' ), url ) );
		} else {
			window.prompt( __( 'Copy this link:', 'noteflow' ), url );
		}
	}

	async function setColor( id, color ) {
		const n = S.notes.get( id );
		if ( n ) {
			n.color = color;
		}
		renderList();
		try {
			const res = await api.post( '/notes/' + id, { color } );
			upsert( res.note );
			renderList();
		} catch ( err ) {
			failed( err );
		}
	}

	const toLocalInput = ( d ) => {
		const p = ( x ) => String( x ).padStart( 2, '0' );
		return d.getFullYear() + '-' + p( d.getMonth() + 1 ) + '-' + p( d.getDate() ) + 'T' + p( d.getHours() ) + ':' + p( d.getMinutes() );
	};

	function reminderDialog( id ) {
		const n = S.notes.get( id );
		if ( ! n ) {
			return;
		}
		const now = new Date();
		const at = ( days, hours ) => {
			const d = new Date( now );
			d.setDate( d.getDate() + days );
			d.setHours( hours, 0, 0, 0 );
			return d;
		};
		const presets = [];
		const later = new Date( now.getTime() + 3 * 3600000 );
		later.setMinutes( 0, 0, 0 );
		if ( later.getDate() === now.getDate() && later.getHours() <= 21 ) {
			presets.push( [ __( 'Later Today', 'noteflow' ), later ] );
		}
		presets.push( [ __( 'Tomorrow', 'noteflow' ), at( 1, 9 ) ] );
		presets.push( [ __( 'Next Week', 'noteflow' ), at( ( 8 - now.getDay() ) % 7 || 7, 9 ) ] );

		const value = n.reminder && ! n.reminded ? toLocalInput( new Date( n.reminder * 1000 ) ) : toLocalInput( at( 1, 9 ) );
		const done = ( ts ) => setReminder( id, ts );

		UI.dialog( {
			title: n.reminder ? __( 'Edit Reminder', 'noteflow' ) : __( 'Remind Me', 'noteflow' ),
			className: 'is-small',
			body:
				'<div class="nf-presets">' +
				presets.map( ( p, i ) => '<button type="button" class="nf-preset" data-preset="' + i + '"><strong>' + esc( p[ 0 ] ) + '</strong><span>' + esc( UI.reminderLabel( p[ 1 ].getTime() / 1000 ) ) + '</span></button>' ).join( '' ) +
				'</div>' +
				'<label class="nf-field"><span>' + esc( __( 'Or pick a date and time', 'noteflow' ) ) + '</span><input type="datetime-local" value="' + value + '" min="' + toLocalInput( now ) + '"></label>' +
				'<p class="nf-muted">' + esc( settings.emails ? __( 'NoteFlow will notify you here, and by email.', 'noteflow' ) : __( 'NoteFlow will notify you here.', 'noteflow' ) ) + '</p>',
			actions: [
				n.reminder && {
					label: __( 'Remove', 'noteflow' ),
					danger: true,
					action: ( close ) => {
						close();
						done( 0 );
					},
				},
				{ label: __( 'Cancel', 'noteflow' ) },
				{
					label: __( 'Set Reminder', 'noteflow' ),
					primary: true,
					action: ( close, el ) => {
						const input = el.querySelector( 'input' );
						const ts = Math.round( new Date( input.value ).getTime() / 1000 );
						if ( ! ts || ts * 1000 < Date.now() - 60000 ) {
							input.focus();
							return;
						}
						close();
						done( ts );
					},
				},
			].filter( Boolean ),
			onOpen: ( el, close ) =>
				el.querySelectorAll( '[data-preset]' ).forEach( ( btn ) =>
					btn.addEventListener( 'click', () => {
						close();
						done( Math.round( presets[ btn.dataset.preset ][ 1 ].getTime() / 1000 ) );
					} )
				),
		} );
	}

	async function setReminder( id, at ) {
		try {
			const res = await api.post( '/notes/' + id + '/reminder', { at } );
			upsert( res.note );
			renderSidebar();
			renderList();
			renderNoteMeta();
			/* translators: %s: date and time. */
			UI.toast( at ? sprintf( __( 'Reminder set for %s.', 'noteflow' ), UI.reminderLabel( at ) ) : __( 'Reminder removed.', 'noteflow' ) );
		} catch ( err ) {
			failed( err );
		}
	}

	function statusLabel( status ) {
		return (
			{
				draft: __( 'Draft', 'noteflow' ),
				pending: __( 'Pending', 'noteflow' ),
				future: __( 'Scheduled', 'noteflow' ),
				private: __( 'Private', 'noteflow' ),
			}[ status ] || ''
		);
	}

	function linkDialog( id ) {
		const n = S.notes.get( id );
		if ( ! n ) {
			return;
		}
		UI.dialog( {
			title: __( 'Attach to a Post or Page', 'noteflow' ),
			body:
				'<p class="nf-muted">' + esc( __( 'The note will appear in the Notes box when anyone who can open it edits that post.', 'noteflow' ) ) + '</p>' +
				'<div class="nf-search is-boxed">' + icon( 'search', 15 ) + '<input type="search" placeholder="' + esc( __( 'Search posts and pages', 'noteflow' ) ) + '" aria-label="' + esc( __( 'Search posts and pages', 'noteflow' ) ) + '"></div>' +
				'<ul class="nf-pick-list"></ul>',
			actions: [
				n.linked && {
					label: __( 'Detach', 'noteflow' ),
					danger: true,
					action: ( close ) => {
						close();
						linkTo( id, 0 );
					},
				},
				{ label: __( 'Cancel', 'noteflow' ) },
			].filter( Boolean ),
			onOpen: ( el, close ) => {
				const input = el.querySelector( 'input' );
				const list = el.querySelector( '.nf-pick-list' );
				let token = 0;
				const load = debounce( async () => {
					const mine = ++token;
					list.innerHTML = '<li class="nf-muted">' + esc( __( 'Searching…', 'noteflow' ) ) + '</li>';
					try {
						const res = await api.get( '/content', { search: input.value.trim() } );
						if ( mine !== token ) {
							return;
						}
						list.innerHTML = res.items.length
							? res.items
									.map(
										( item ) =>
											'<li><button type="button" class="nf-pick" data-post="' + item.id + '">' + icon( 'file', 16 ) +
											'<span><strong>' + esc( item.title ) + '</strong><span>' + esc( item.type ) + ( statusLabel( item.status ) ? ' · ' + esc( statusLabel( item.status ) ) : '' ) + '</span></span></button></li>'
									)
									.join( '' )
							: '<li class="nf-muted">' + esc( __( 'Nothing found.', 'noteflow' ) ) + '</li>';
					} catch ( err ) {
						list.innerHTML = '<li class="nf-muted">' + esc( errorMessage( err ) ) + '</li>';
					}
				}, 200 );
				input.addEventListener( 'input', load );
				load();
				list.addEventListener( 'click', ( e ) => {
					const btn = e.target.closest( '[data-post]' );
					if ( btn ) {
						close();
						linkTo( id, Number( btn.dataset.post ) );
					}
				} );
			},
		} );
	}

	async function linkTo( id, post ) {
		try {
			const res = await api.post( '/notes/' + id + '/link', { post } );
			upsert( res.note );
			renderNoteMeta();
			renderList();
			UI.toast( post ? __( 'Note attached.', 'noteflow' ) : __( 'Note detached.', 'noteflow' ) );
		} catch ( err ) {
			failed( err );
		}
	}

	/* Export and print ------------------------------------------------------------------------ */

	async function fullNote( id ) {
		if ( S.current && S.current.id === id ) {
			await flushSave();
			return { title: titleEl.value.trim() || noteTitle( S.current.note ), content: editor.getContent() };
		}
		const res = await api.get( '/notes/' + id );
		return { title: res.note.titleRaw || noteTitle( res.note ), content: res.note.content };
	}

	const EXPORT_CSS =
		'body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;max-width:720px;margin:48px auto;padding:0 24px}' +
		'h1{font-size:30px;line-height:1.2}h2{font-size:22px}h3{font-size:18px}img{max-width:100%;height:auto;border-radius:8px}' +
		'ul.nf-checklist{list-style:none;padding-left:4px}ul.nf-checklist li::before{content:"\\25CB";margin-right:10px}ul.nf-checklist li.nf-checked::before{content:"\\25CF";color:#e8a600}' +
		'ul.nf-dashed{list-style:none;padding-left:4px}ul.nf-dashed li::before{content:"\\2013";margin-right:10px}' +
		'table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #d2d2d7;padding:6px 10px;text-align:left}' +
		'pre{background:#f5f5f7;padding:12px 14px;border-radius:8px;white-space:pre-wrap}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em}' +
		'blockquote{margin:12px 0;padding:2px 16px;border-left:3px solid #e8a600;color:#515154}mark{background:#ffe58a}a{color:#0a64d6}';

	function htmlDocument( note ) {
		return '<!doctype html><html lang="' + esc( locale ) + '"><head><meta charset="utf-8"><title>' + esc( note.title ) + '</title><style>' + EXPORT_CSS + '</style></head><body><article><h1>' + esc( note.title ) + '</h1>' + note.content + '</article></body></html>';
	}

	async function exportNote( id, format ) {
		try {
			const note = await fullNote( id );
			const name = UI.slug( note.title );
			if ( format === 'md' ) {
				UI.download( name + '.md', UI.toMarkdown( note.content, note.title ), 'text/markdown' );
			} else {
				UI.download( name + '.html', htmlDocument( note ), 'text/html' );
			}
		} catch ( err ) {
			failed( err );
		}
	}

	async function printNote( id ) {
		try {
			const note = await fullNote( id );
			const frame = document.createElement( 'iframe' );
			frame.setAttribute( 'aria-hidden', 'true' );
			frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
			document.body.appendChild( frame );
			const doc = frame.contentDocument;
			doc.open();
			doc.write( htmlDocument( note ) );
			doc.close();
			setTimeout( () => {
				frame.contentWindow.focus();
				frame.contentWindow.print();
				setTimeout( () => frame.remove(), 2000 );
			}, 300 );
		} catch ( err ) {
			failed( err );
		}
	}

	async function exportAll() {
		try {
			const res = await api.get( '/export' );
			UI.download( 'noteflow-notes-' + new Date().toISOString().slice( 0, 10 ) + '.json', JSON.stringify( res, null, 2 ), 'application/json' );
			/* translators: %d: number of notes. */
			UI.toast( sprintf( _n( 'Exported %d note.', 'Exported %d notes.', res.notes.length, 'noteflow' ), res.notes.length ) );
		} catch ( err ) {
			failed( err );
		}
	}

	function importNotes() {
		const input = document.createElement( 'input' );
		input.type = 'file';
		input.accept = '.json,.md,.markdown,.txt,.html,.htm';
		input.multiple = true;
		input.addEventListener( 'change', async () => {
			const notes = [];
			for ( const file of Array.from( input.files ) ) {
				const text = await file.text();
				const name = file.name.replace( /\.[^.]+$/, '' );
				if ( /\.json$/i.test( file.name ) ) {
					let json = null;
					try {
						json = JSON.parse( text );
					} catch ( e ) {}
					if ( ! json || json.format !== 'noteflow' || ! Array.isArray( json.notes ) ) {
						/* translators: %s: file name. */
						UI.toast( sprintf( __( '%s is not a NoteFlow backup.', 'noteflow' ), file.name ), { error: true } );
						return;
					}
					notes.push( ...json.notes );
				} else if ( /\.html?$/i.test( file.name ) ) {
					notes.push( { title: name, content: HTML.clean( text ) } );
				} else if ( /\.(md|markdown)$/i.test( file.name ) ) {
					let md = text;
					let title = name;
					const heading = md.match( /^#\s+(.+)\n+/ );
					if ( heading ) {
						title = heading[ 1 ].trim();
						md = md.slice( heading[ 0 ].length );
					}
					notes.push( { title, content: UI.fromMarkdown( md ) } );
				} else {
					notes.push( { title: name, content: HTML.fromText( text ) } );
				}
			}
			if ( ! notes.length ) {
				return;
			}
			UI.toast( __( 'Importing…', 'noteflow' ) );
			try {
				const res = await api.post( '/import', { notes } );
				S.notes = new Map();
				res.notes.forEach( ( n ) => S.notes.set( n.id, n ) );
				S.notes.forEach( ( n, id ) => touch( id ) );
				Object.assign( S.people, res.people || {} );
				S.folders = res.folders;
				S.filed = Object.assign( {}, res.filed );
				S.pins = res.pins;
				renderAll();
				/* translators: %d: number of notes. */
				UI.toast( sprintf( _n( 'Imported %d note.', 'Imported %d notes.', res.imported, 'noteflow' ), res.imported ) );
			} catch ( err ) {
				failed( err );
			}
		} );
		input.click();
	}

	/* Images ------------------------------------------------------------------------------ */

	function insertImageFromLibrary() {
		if ( ! window.wp || ! wp.media ) {
			return;
		}
		const frame = wp.media( {
			title: __( 'Add Image', 'noteflow' ),
			library: { type: 'image' },
			multiple: false,
			button: { text: __( 'Add to Note', 'noteflow' ) },
		} );
		frame.on( 'select', () => {
			const img = frame.state().get( 'selection' ).first().toJSON();
			const url = ( img.sizes && img.sizes.large && img.sizes.large.url ) || img.url;
			editor.insertImage( url, img.alt || '' );
		} );
		frame.open();
	}

	async function uploadImage( file ) {
		if ( ! me.canUpload ) {
			UI.toast( __( 'You do not have permission to upload images on this site.', 'noteflow' ), { error: true } );
			return;
		}
		UI.toast( __( 'Uploading image…', 'noteflow' ) );
		const form = new FormData();
		form.append( 'file', file, file.name || 'pasted-image.png' );
		try {
			const media = await wp.apiFetch( { path: '/wp/v2/media', method: 'POST', body: form } );
			const sizes = media.media_details && media.media_details.sizes;
			editor.insertImage( ( sizes && sizes.large && sizes.large.source_url ) || media.source_url, media.alt_text || '' );
			UI.toast( __( 'Image added.', 'noteflow' ) );
		} catch ( err ) {
			failed( err );
		}
	}

	/* Menus -------------------------------------------------------------------------------- */

	function formatMenu( anchor ) {
		const st = editor.state() || { block: 'p', list: '' };
		const block = ( tag, label, hint ) => ( { label, hint, checked: st.block === tag && ! st.list, action: () => editor.setBlock( tag ) } );
		const list = ( kind, label, hint ) => ( { label, hint, checked: st.list === kind, action: () => editor.toggleList( kind ) } );
		const inline = ( kind, label, hint, on ) => ( { label, hint, checked: !! on, action: () => editor.inline( kind ) } );
		UI.menu(
			anchor,
			[
				block( 'h1', __( 'Title', 'noteflow' ), MOD + ALT + '1' ),
				block( 'h2', __( 'Heading', 'noteflow' ), MOD + ALT + '2' ),
				block( 'h3', __( 'Subheading', 'noteflow' ), MOD + ALT + '3' ),
				block( 'p', __( 'Body', 'noteflow' ), MOD + ALT + '0' ),
				block( 'pre', __( 'Monospaced', 'noteflow' ), MOD + ALT + '9' ),
				block( 'blockquote', __( 'Block Quote', 'noteflow' ) ),
				'-',
				list( 'ul', __( 'Bulleted List', 'noteflow' ), MOD + SHIFT + '8' ),
				list( 'dashed', __( 'Dashed List', 'noteflow' ) ),
				list( 'ol', __( 'Numbered List', 'noteflow' ), MOD + SHIFT + '7' ),
				list( 'check', __( 'Checklist', 'noteflow' ), MOD + SHIFT + 'L' ),
				'-',
				inline( 'bold', __( 'Bold', 'noteflow' ), MOD + 'B', st.bold ),
				inline( 'italic', __( 'Italic', 'noteflow' ), MOD + 'I', st.italic ),
				inline( 'underline', __( 'Underline', 'noteflow' ), MOD + 'U', st.underline ),
				inline( 'strike', __( 'Strikethrough', 'noteflow' ), MOD + SHIFT + 'X', st.strike ),
				inline( 'mark', __( 'Highlight', 'noteflow' ), MOD + SHIFT + 'H', st.mark ),
				inline( 'code', __( 'Inline Code', 'noteflow' ), MOD + 'E', st.code ),
			],
			{ className: 'nf-format-menu' }
		);
	}

	function tableMenu( anchor ) {
		const st = editor.state() || {};
		if ( ! st.table ) {
			editor.insertTable( 3, 3 );
			return;
		}
		const act = ( action ) => () => editor.tableAction( action );
		UI.menu( anchor, [
			{ label: __( 'Add Row Above', 'noteflow' ), action: act( 'row-above' ) },
			{ label: __( 'Add Row Below', 'noteflow' ), action: act( 'row-below' ) },
			{ label: __( 'Add Column Before', 'noteflow' ), action: act( 'col-left' ) },
			{ label: __( 'Add Column After', 'noteflow' ), action: act( 'col-right' ) },
			'-',
			{ label: __( 'Delete Row', 'noteflow' ), action: act( 'row-delete' ) },
			{ label: __( 'Delete Column', 'noteflow' ), action: act( 'col-delete' ) },
			{ label: __( 'Delete Table', 'noteflow' ), icon: 'trash', danger: true, action: act( 'delete' ) },
		] );
	}

	function sortMenu( anchor ) {
		const p = S.prefs;
		UI.menu(
			anchor,
			[
				{ heading: __( 'Sort By', 'noteflow' ) },
				{ label: __( 'Date Edited', 'noteflow' ), checked: p.sort === 'modified', action: () => setPref( { sort: 'modified' } ) },
				{ label: __( 'Date Created', 'noteflow' ), checked: p.sort === 'created', action: () => setPref( { sort: 'created' } ) },
				{ label: __( 'Title', 'noteflow' ), checked: p.sort === 'title', action: () => setPref( { sort: 'title' } ) },
				'-',
				{ label: __( 'Group by Date', 'noteflow' ), checked: !! p.group, action: () => setPref( { group: ! p.group } ) },
				'-',
				{ label: __( 'View as List', 'noteflow' ), checked: p.view === 'list', action: () => setPref( { view: 'list' } ) },
				{ label: __( 'View as Gallery', 'noteflow' ), checked: p.view === 'gallery', action: () => setPref( { view: 'gallery' } ) },
			],
			{ align: 'end' }
		);
	}

	function weekdays() {
		const monday = new Date( 2024, 0, 1 );
		const fmt = new Intl.DateTimeFormat( locale, { weekday: 'long' } );
		return [ 0, 1, 2, 3, 4 ].map( ( i ) => fmt.format( new Date( monday.getTime() + i * 86400000 ) ) );
	}

	function templates() {
		const e = esc;
		const today = new Intl.DateTimeFormat( locale, { day: 'numeric', month: 'long', year: 'numeric' } ).format( new Date() );
		const empty = '<li><br></li>';
		return [
			{
				label: __( 'Meeting notes', 'noteflow' ),
				/* translators: %s: date. */
				title: sprintf( __( 'Meeting notes, %s', 'noteflow' ), today ),
				content:
					'<p><strong>' + e( __( 'Attendees:', 'noteflow' ) ) + '</strong> </p>' +
					'<h2>' + e( __( 'Agenda', 'noteflow' ) ) + '</h2><ol>' + empty + '</ol>' +
					'<h2>' + e( __( 'Notes', 'noteflow' ) ) + '</h2><p><br></p>' +
					'<h2>' + e( __( 'Action items', 'noteflow' ) ) + '</h2><ul class="nf-checklist">' + empty + '</ul>',
			},
			{
				label: __( 'To-do list', 'noteflow' ),
				title: __( 'To-do', 'noteflow' ),
				content: '<ul class="nf-checklist">' + empty + '</ul>',
			},
			{
				label: __( 'Content brief', 'noteflow' ),
				title: __( 'Content brief', 'noteflow' ),
				content:
					'<p><strong>' + e( __( 'Working title:', 'noteflow' ) ) + '</strong> </p>' +
					'<p><strong>' + e( __( 'Audience:', 'noteflow' ) ) + '</strong> </p>' +
					'<p><strong>' + e( __( 'Main keyword:', 'noteflow' ) ) + '</strong> </p>' +
					'<h2>' + e( __( 'Outline', 'noteflow' ) ) + '</h2><ol>' + empty + '</ol>' +
					'<h2>' + e( __( 'Sources', 'noteflow' ) ) + '</h2><ul>' + empty + '</ul>' +
					'<h2>' + e( __( 'Before publishing', 'noteflow' ) ) + '</h2><ul class="nf-checklist">' +
					[ __( 'Draft written', 'noteflow' ), __( 'Edited and proofread', 'noteflow' ), __( 'Images added', 'noteflow' ), __( 'SEO title and description', 'noteflow' ), __( 'Scheduled or published', 'noteflow' ) ].map( ( t ) => '<li>' + e( t ) + '</li>' ).join( '' ) +
					'</ul>',
			},
			{
				label: __( 'Bug report', 'noteflow' ),
				title: __( 'Bug report', 'noteflow' ),
				content:
					'<h2>' + e( __( 'What happened', 'noteflow' ) ) + '</h2><p><br></p>' +
					'<h2>' + e( __( 'Steps to reproduce', 'noteflow' ) ) + '</h2><ol>' + empty + '</ol>' +
					'<h2>' + e( __( 'What should happen', 'noteflow' ) ) + '</h2><p><br></p>' +
					'<h2>' + e( __( 'Environment', 'noteflow' ) ) + '</h2><table class="nf-table"><tbody>' +
					[ 'WordPress', 'PHP', __( 'Theme', 'noteflow' ), __( 'Browser', 'noteflow' ) ].map( ( t ) => '<tr><td>' + e( t ) + '</td><td><br></td></tr>' ).join( '' ) +
					'</tbody></table>',
			},
			{
				label: __( 'Launch checklist', 'noteflow' ),
				title: __( 'Launch checklist', 'noteflow' ),
				content:
					'<ul class="nf-checklist">' +
					[ __( 'Back up the site', 'noteflow' ), __( 'Test on a staging site', 'noteflow' ), __( 'Update plugins and themes', 'noteflow' ), __( 'Check forms and emails', 'noteflow' ), __( 'Check on a phone', 'noteflow' ), __( 'Clear caches', 'noteflow' ), __( 'Announce it', 'noteflow' ) ]
						.map( ( t ) => '<li>' + e( t ) + '</li>' )
						.join( '' ) +
					'</ul>',
			},
			{
				label: __( 'Weekly plan', 'noteflow' ),
				/* translators: %s: date. */
				title: sprintf( __( 'Week of %s', 'noteflow' ), today ),
				content: '<h2>' + e( __( 'Priorities', 'noteflow' ) ) + '</h2><ul class="nf-checklist">' + empty + '</ul>' + weekdays().map( ( day ) => '<h3>' + e( day ) + '</h3><p><br></p>' ).join( '' ),
			},
		];
	}

	function templatesMenu( anchor ) {
		UI.menu(
			anchor,
			[ { heading: __( 'New from Template', 'noteflow' ) } ].concat( templates().map( ( t ) => ( { label: t.label, icon: 'template', action: () => newNote( t ) } ) ) ),
			{ align: 'end' }
		);
	}

	function folderItems( id ) {
		const n = S.notes.get( id );
		const current = n ? folderOf( n ) : '';
		return [ { label: __( 'Notes', 'noteflow' ), icon: 'folder', checked: ! current, action: () => moveTo( id, '' ) } ]
			.concat( S.folders.map( ( f ) => ( { label: f.name, icon: 'folder', checked: current === f.id, action: () => moveTo( id, f.id ) } ) ) )
			.concat( [ '-', { label: __( 'New Folder…', 'noteflow' ), icon: 'folderPlus', action: () => newFolder( id ) } ] );
	}

	function colorItem( id, current ) {
		return {
			html:
				'<div class="nf-swatches" role="group" aria-label="' + esc( __( 'Colour', 'noteflow' ) ) + '">' +
				COLORS.map( ( c ) => '<button type="button" class="nf-swatch' + ( c[ 0 ] === ( current || '' ) ? ' is-active' : '' ) + '" data-color="' + c[ 0 ] + '" style="--swatch:' + ( c[ 0 ] || 'transparent' ) + '" aria-label="' + esc( c[ 1 ] ) + '" title="' + esc( c[ 1 ] ) + '"></button>' ).join( '' ) +
				'</div>',
			bind: ( box, close ) =>
				box.addEventListener( 'click', ( e ) => {
					const btn = e.target.closest( '[data-color]' );
					if ( btn ) {
						close();
						setColor( id, btn.dataset.color );
					}
				} ),
		};
	}

	function noteMenu( anchor, id ) {
		const n = S.notes.get( id );
		if ( ! n ) {
			return;
		}
		const owner = n.role === 'owner';
		const edit = canEdit( n );
		const open = S.current && S.current.id === id;

		if ( n.status === 'trash' ) {
			UI.menu(
				anchor,
				[
					owner && { label: __( 'Recover', 'noteflow' ), icon: 'restore', action: () => restoreNote( id, true ) },
					owner && { label: __( 'Delete for Good', 'noteflow' ), icon: 'trash', danger: true, action: () => deleteForever( id ) },
				].filter( Boolean ),
				{ align: 'end' }
			);
			return;
		}

		const items = [
			{ label: isPinned( id ) ? __( 'Unpin Note', 'noteflow' ) : __( 'Pin Note', 'noteflow' ), icon: 'pin', action: () => togglePin( id ) },
			{ label: __( 'Move to', 'noteflow' ), icon: 'folder', submenu: folderItems( id ) },
		];
		if ( modules.reminders && edit ) {
			items.push( { label: n.reminder ? __( 'Edit Reminder…', 'noteflow' ) : __( 'Add Reminder…', 'noteflow' ), icon: 'clock', action: () => reminderDialog( id ) } );
		}
		if ( modules.content_notes && edit ) {
			items.push( { label: n.linked ? __( 'Attached Post…', 'noteflow' ) : __( 'Attach to a Post or Page…', 'noteflow' ), icon: 'file', action: () => linkDialog( id ) } );
		}
		if ( edit ) {
			items.push( colorItem( id, n.color ) );
		}
		items.push( '-' );
		if ( settings.sharing ) {
			items.push( { label: owner ? __( 'Share…', 'noteflow' ) : __( 'People with Access…', 'noteflow' ), icon: 'userPlus', action: () => openShare( id ) } );
		}
		if ( open ) {
			if ( settings.comments ) {
				items.push( { label: __( 'Comments', 'noteflow' ), icon: 'comment', action: () => openActivity( 'comments' ) } );
			}
			items.push( { label: __( 'Version History', 'noteflow' ), icon: 'history', action: () => openActivity( 'history' ) } );
		}
		items.push( { label: __( 'Duplicate', 'noteflow' ), icon: 'copy', action: () => duplicate( id ) } );
		items.push( { label: __( 'Copy Link', 'noteflow' ), icon: 'link', action: () => copyLink( id ) } );
		if ( modules.export ) {
			items.push(
				'-',
				{ label: __( 'Export as Markdown', 'noteflow' ), icon: 'download', action: () => exportNote( id, 'md' ) },
				{ label: __( 'Export as HTML', 'noteflow' ), icon: 'download', action: () => exportNote( id, 'html' ) },
				{ label: __( 'Print', 'noteflow' ), icon: 'printer', action: () => printNote( id ) }
			);
		}
		if ( open && edit && n.checklist && n.checklist[ 1 ] ) {
			items.push(
				'-',
				{ label: __( 'Move Ticked Items to Bottom', 'noteflow' ), icon: 'checklist', action: () => editor.moveCheckedDown() },
				{ label: __( 'Untick All Items', 'noteflow' ), icon: 'checklist', action: () => editor.uncheckAll() }
			);
		}
		items.push( '-' );
		if ( owner ) {
			items.push( { label: __( 'Delete', 'noteflow' ), icon: 'trash', danger: true, action: () => trashNote( id ) } );
		} else {
			items.push( { label: __( 'Remove from My Notes', 'noteflow' ), icon: 'leave', danger: true, action: () => leaveNote( id ) } );
		}
		/* translators: 1: number of words, 2: date. */
		const info = sprintf( _n( '%1$s word · created %2$s', '%1$s words · created %2$s', n.words || 0, 'noteflow' ), ( n.words || 0 ).toLocaleString( locale ), UI.mediumDate( n.created ) );
		items.push( { html: '<p class="nf-menu-info">' + esc( info ) + '</p>' } );

		UI.menu( anchor, items, { align: 'end' } );
	}

	function folderMenu( anchor, id ) {
		UI.menu(
			anchor,
			[
				{ label: __( 'Rename Folder…', 'noteflow' ), icon: 'compose', action: () => renameFolder( id ) },
				{ label: __( 'Delete Folder…', 'noteflow' ), icon: 'trash', danger: true, action: () => deleteFolder( id ) },
			],
			{ align: 'end' }
		);
	}

	/* Share dialog -------------------------------------------------------------------------- */

	async function openShare( id ) {
		id = id || ( S.current && S.current.id );
		const n = S.notes.get( id );
		if ( ! n ) {
			return;
		}
		let share;
		try {
			share = await api.get( '/notes/' + id + '/share' );
		} catch ( err ) {
			failed( err );
			return;
		}
		Object.assign( S.people, share.people || {} );

		const owner = n.role === 'owner';
		const state = { everyone: share.everyone, users: share.users.map( ( u ) => ( { id: u.id, role: u.role } ) ) };
		let chain = Promise.resolve();

		const peopleList = () => {
			const ownerPerson = person( share.owner );
			let html =
				'<li class="nf-share-person"><span class="nf-share-who">' + UI.avatar( ownerPerson, 32 ) +
				'<span class="nf-share-name"><strong>' + esc( ownerPerson.name ) + ( share.owner === me.id ? ' ' + esc( __( '(you)', 'noteflow' ) ) : '' ) + '</strong><span>' + esc( __( 'Owner', 'noteflow' ) ) + '</span></span></span></li>';
			state.users.forEach( ( u ) => {
				const p = person( u.id );
				/* translators: %s: person's name. */
				const label = sprintf( __( 'Access for %s', 'noteflow' ), p.name );
				html +=
					'<li class="nf-share-person" data-user="' + u.id + '"><span class="nf-share-who">' + UI.avatar( p, 32 ) +
					'<span class="nf-share-name"><strong>' + esc( p.name ) + ( u.id === me.id ? ' ' + esc( __( '(you)', 'noteflow' ) ) : '' ) + '</strong></span></span>' +
					( owner
						? '<select data-role aria-label="' + esc( label ) + '"><option value="edit"' + ( u.role === 'edit' ? ' selected' : '' ) + '>' + esc( __( 'Can edit', 'noteflow' ) ) + '</option><option value="view"' + ( u.role === 'view' ? ' selected' : '' ) + '>' + esc( __( 'Can view', 'noteflow' ) ) + '</option><option value="remove">' + esc( __( 'Remove', 'noteflow' ) ) + '</option></select>'
						: '<span class="nf-share-role">' + esc( u.role === 'edit' ? __( 'Can edit', 'noteflow' ) : __( 'Can view', 'noteflow' ) ) + '</span>' ) +
					'</li>';
			} );
			return html;
		};

		const saveShare = () => {
			chain = chain.then( () =>
				api
					.post( '/notes/' + id + '/share', { everyone: state.everyone, users: state.users } )
					.then( ( res ) => {
						Object.assign( S.people, res.people || {} );
						upsert( res.note );
						renderList();
						renderSidebar();
						renderToolbar();
						renderNoteMeta();
						scheduleSync( 300 );
					} )
					.catch( failed )
			);
			return chain;
		};

		const addTitle = __( 'Add people by name', 'noteflow' );
		UI.dialog( {
			/* translators: %s: note title. */
			title: sprintf( __( 'Share “%s”', 'noteflow' ), noteTitle( n ) ),
			className: 'nf-share-dialog',
			body:
				( owner
					? '<div class="nf-share-add"><div class="nf-share-input">' + icon( 'userPlus', 16 ) + '<input type="search" placeholder="' + esc( addTitle ) + '" aria-label="' + esc( addTitle ) + '" autocomplete="off" role="combobox" aria-expanded="false"></div>' +
					  '<select class="nf-share-new-role" aria-label="' + esc( __( 'Access for people you add', 'noteflow' ) ) + '"><option value="edit">' + esc( __( 'Can edit', 'noteflow' ) ) + '</option><option value="view">' + esc( __( 'Can view', 'noteflow' ) ) + '</option></select></div>' +
					  '<ul class="nf-share-suggest" role="listbox" hidden></ul>'
					: '<p class="nf-muted">' + esc( __( 'Only the owner can change who has access.', 'noteflow' ) ) + '</p>' ) +
				'<h3 class="nf-share-heading">' + esc( __( 'People with access', 'noteflow' ) ) + '</h3>' +
				'<ul class="nf-share-list">' + peopleList() + '</ul>' +
				( settings.everyone
					? '<h3 class="nf-share-heading">' + esc( __( 'General access', 'noteflow' ) ) + '</h3>' +
					  '<div class="nf-share-general">' + icon( 'globe', 18 ) + '<select data-everyone ' + ( owner ? '' : 'disabled' ) + ' aria-label="' + esc( __( 'General access', 'noteflow' ) ) + '">' +
					  '<option value="">' + esc( __( 'Only people added above', 'noteflow' ) ) + '</option>' +
					  '<option value="view"' + ( state.everyone === 'view' ? ' selected' : '' ) + '>' + esc( __( 'Everyone with NoteFlow can view', 'noteflow' ) ) + '</option>' +
					  '<option value="edit"' + ( state.everyone === 'edit' ? ' selected' : '' ) + '>' + esc( __( 'Everyone with NoteFlow can edit', 'noteflow' ) ) + '</option>' +
					  '</select></div>'
					: '' ),
			actions: [
				! owner && {
					label: __( 'Remove from My Notes', 'noteflow' ),
					danger: true,
					action: ( close ) => {
						close();
						leaveNote( id );
					},
				},
				{ label: __( 'Copy Link', 'noteflow' ), action: () => copyLink( id ) },
				{ label: __( 'Done', 'noteflow' ), primary: true },
			].filter( Boolean ),
			onOpen: ( el ) => {
				const list = el.querySelector( '.nf-share-list' );
				const refresh = () => ( list.innerHTML = peopleList() );

				list.addEventListener( 'change', ( e ) => {
					const select = e.target.closest( '[data-role]' );
					if ( ! select ) {
						return;
					}
					const uid = Number( select.closest( '[data-user]' ).dataset.user );
					if ( select.value === 'remove' ) {
						state.users = state.users.filter( ( u ) => u.id !== uid );
						refresh();
					} else {
						state.users.forEach( ( u ) => u.id === uid && ( u.role = select.value ) );
					}
					saveShare();
				} );

				const everyone = el.querySelector( '[data-everyone]' );
				if ( everyone ) {
					everyone.addEventListener( 'change', () => {
						state.everyone = everyone.value;
						saveShare();
					} );
				}

				const input = el.querySelector( '.nf-share-input input' );
				if ( ! input ) {
					return;
				}
				const suggest = el.querySelector( '.nf-share-suggest' );
				const newRole = el.querySelector( '.nf-share-new-role' );
				let found = [];
				let token = 0;
				let active = 0;

				const renderSuggest = () => {
					suggest.hidden = ! found.length;
					input.setAttribute( 'aria-expanded', found.length ? 'true' : 'false' );
					suggest.innerHTML = found
						.map( ( p, i ) => '<li role="option" aria-selected="' + ( i === active ) + '"><button type="button" data-add="' + p.id + '" class="' + ( i === active ? 'is-active' : '' ) + '">' + UI.avatar( p, 24 ) + '<span>' + esc( p.name ) + '</span></button></li>' )
						.join( '' );
				};
				const add = ( pid ) => {
					if ( ! state.users.some( ( u ) => u.id === pid ) ) {
						state.users.push( { id: pid, role: newRole.value } );
						refresh();
						saveShare();
					}
					input.value = '';
					found = [];
					renderSuggest();
					input.focus();
				};
				const search = debounce( async () => {
					const q = input.value.trim();
					const mine = ++token;
					if ( ! q ) {
						found = [];
						renderSuggest();
						return;
					}
					try {
						const res = await api.get( '/people', { search: q } );
						if ( mine !== token ) {
							return;
						}
						res.people.forEach( ( p ) => ( S.people[ p.id ] = p ) );
						found = res.people.filter( ( p ) => p.id !== share.owner && ! state.users.some( ( u ) => u.id === p.id ) ).slice( 0, 6 );
						active = 0;
						renderSuggest();
					} catch ( err ) {}
				}, 180 );

				input.addEventListener( 'input', search );
				input.addEventListener( 'keydown', ( e ) => {
					if ( ! found.length ) {
						return;
					}
					if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
						e.preventDefault();
						active = ( active + ( e.key === 'ArrowDown' ? 1 : -1 ) + found.length ) % found.length;
						renderSuggest();
					} else if ( e.key === 'Enter' ) {
						e.preventDefault();
						add( found[ active ].id );
					}
				} );
				suggest.addEventListener( 'click', ( e ) => {
					const btn = e.target.closest( '[data-add]' );
					if ( btn ) {
						add( Number( btn.dataset.add ) );
					}
				} );
			},
		} );
	}

	/* Notifications and preferences ------------------------------------------------------------ */

	function notificationText( item ) {
		const who = person( item.actor ).name;
		const title = item.title || __( 'New Note', 'noteflow' );
		switch ( item.type ) {
			case 'share':
				/* translators: 1: person's name, 2: note title. */
				return sprintf( __( '%1$s shared “%2$s” with you', 'noteflow' ), who, title );
			case 'mention':
				/* translators: 1: person's name, 2: note title. */
				return sprintf( __( '%1$s mentioned you in “%2$s”', 'noteflow' ), who, title );
			case 'comment':
				/* translators: 1: person's name, 2: note title. */
				return sprintf( __( '%1$s commented on “%2$s”', 'noteflow' ), who, title );
			case 'reminder':
				/* translators: %s: note title. */
				return sprintf( __( 'Reminder: “%s”', 'noteflow' ), title );
		}
		return title;
	}

	function openNotifications( anchor ) {
		const items = S.notifications.items || [];
		const pop = UI.popover(
			anchor,
			'<div class="nf-pop-head"><h2>' + esc( __( 'Notifications', 'noteflow' ) ) + '</h2></div>' +
				( items.length
					? '<ul class="nf-notif-list">' +
					  items
							.map(
								( item ) =>
									'<li><button type="button" class="nf-notif' + ( item.read ? '' : ' is-unread' ) + '" data-note="' + item.note + '">' +
									( item.type === 'reminder' ? '<span class="nf-notif-icon">' + icon( 'clock', 16 ) + '</span>' : UI.avatar( person( item.actor ), 32 ) ) +
									'<span class="nf-notif-body"><span>' + esc( notificationText( item ) ) + '</span>' +
									( item.text && item.type !== 'share' ? '<q>' + esc( item.text ) + '</q>' : '' ) +
									'<time>' + esc( UI.ago( item.time ) ) + '</time></span></button></li>'
							)
							.join( '' ) +
					  '</ul>'
					: '<p class="nf-notif-empty">' + icon( 'bell', 24 ) + esc( __( 'You are all caught up.', 'noteflow' ) ) + '</p>' ),
			{ className: 'nf-notif-pop', label: __( 'Notifications', 'noteflow' ) }
		);
		pop.addEventListener( 'click', ( e ) => {
			const btn = e.target.closest( '[data-note]' );
			if ( btn ) {
				UI.closePopover();
				goToNote( Number( btn.dataset.note ) );
			}
		} );
		if ( S.notifications.unread ) {
			api.post( '/notifications/read', {} )
				.then( ( res ) => {
					S.notifications.unread = res.unread;
					( S.notifications.items || [] ).forEach( ( item ) => ( item.read = true ) );
					renderSidebar();
					updateMenuBubble();
				} )
				.catch( () => {} );
		}
	}

	async function setPref( changes ) {
		Object.assign( S.prefs, changes );
		if ( 'view' in changes ) {
			S.galleryOpen = false;
		}
		applyTheme();
		renderAll();
		try {
			await api.post( '/prefs', changes );
		} catch ( err ) {}
	}

	function openPrefs( anchor ) {
		const p = S.prefs;
		const themes = [
			[ 'light', __( 'Light', 'noteflow' ) ],
			[ 'dark', __( 'Dark', 'noteflow' ) ],
			[ 'auto', __( 'Auto', 'noteflow' ) ],
		];
		const sorts = [
			[ 'modified', __( 'Date Edited', 'noteflow' ) ],
			[ 'created', __( 'Date Created', 'noteflow' ) ],
			[ 'title', __( 'Title', 'noteflow' ) ],
		];
		const pop = UI.popover(
			anchor,
			'<div class="nf-prefs">' +
				'<div class="nf-pop-head"><h2>' + esc( __( 'Preferences', 'noteflow' ) ) + '</h2></div>' +
				'<div class="nf-pref"><span>' + esc( __( 'Appearance', 'noteflow' ) ) + '</span><div class="nf-segment" role="radiogroup" aria-label="' + esc( __( 'Appearance', 'noteflow' ) ) + '">' +
				themes.map( ( t ) => '<button type="button" role="radio" aria-checked="' + ( p.theme === t[ 0 ] ) + '" data-theme-choice="' + t[ 0 ] + '">' + esc( t[ 1 ] ) + '</button>' ).join( '' ) +
				'</div></div>' +
				'<div class="nf-pref"><span>' + esc( __( 'Accent colour', 'noteflow' ) ) + '</span><div class="nf-accents" role="radiogroup" aria-label="' + esc( __( 'Accent colour', 'noteflow' ) ) + '">' +
				ACCENTS.map( ( a ) => '<button type="button" class="nf-accent" role="radio" aria-checked="' + ( ( p.accent || 'amber' ) === a[ 0 ] ) + '" data-accent-choice="' + a[ 0 ] + '" style="--swatch:' + a[ 2 ] + '" aria-label="' + esc( a[ 1 ] ) + '" title="' + esc( a[ 1 ] ) + '"></button>' ).join( '' ) +
				'</div></div>' +
				'<label class="nf-pref"><span>' + esc( __( 'Sort notes by', 'noteflow' ) ) + '</span><select data-pref="sort">' +
				sorts.map( ( s ) => '<option value="' + s[ 0 ] + '"' + ( p.sort === s[ 0 ] ? ' selected' : '' ) + '>' + esc( s[ 1 ] ) + '</option>' ).join( '' ) +
				'</select></label>' +
				'<label class="nf-pref-check"><input type="checkbox" data-pref="group"' + ( p.group ? ' checked' : '' ) + '><span>' + esc( __( 'Group notes by date', 'noteflow' ) ) + '</span></label>' +
				( settings.emails ? '<label class="nf-pref-check"><input type="checkbox" data-pref="emails"' + ( p.emails ? ' checked' : '' ) + '><span>' + esc( __( 'Email me about shares, mentions and reminders', 'noteflow' ) ) + '</span></label>' : '' ) +
				'<div class="nf-prefs-links">' +
				'<button type="button" data-do="shortcuts">' + icon( 'keyboard', 16 ) + esc( __( 'Keyboard Shortcuts', 'noteflow' ) ) + '</button>' +
				( modules.export
					? '<button type="button" data-do="export">' + icon( 'download', 16 ) + esc( __( 'Export All My Notes', 'noteflow' ) ) + '</button>' +
					  '<button type="button" data-do="import">' + icon( 'upload', 16 ) + esc( __( 'Import Notes…', 'noteflow' ) ) + '</button>'
					: '' ) +
				( data.urls.settings ? '<a href="' + esc( data.urls.settings ) + '">' + icon( 'sliders', 16 ) + esc( __( 'NoteFlow Settings', 'noteflow' ) ) + '</a>' : '' ) +
				'<a href="' + esc( data.urls.review ) + '" target="_blank" rel="noopener noreferrer">' + icon( 'star', 16 ) + esc( __( 'Rate NoteFlow on WordPress.org', 'noteflow' ) ) + '</a>' +
				'<a href="' + esc( data.urls.support ) + '" target="_blank" rel="noopener noreferrer">' + icon( 'comment', 16 ) + esc( __( 'Help and Feedback', 'noteflow' ) ) + '</a>' +
				'</div>' +
				'<p class="nf-prefs-version">NoteFlow ' + esc( data.version ) + '</p>' +
				'</div>',
			{ className: 'nf-prefs-pop', label: __( 'Preferences', 'noteflow' ) }
		);

		pop.addEventListener( 'click', ( e ) => {
			const accent = e.target.closest( '[data-accent-choice]' );
			if ( accent ) {
				pop.querySelectorAll( '[data-accent-choice]' ).forEach( ( b ) => b.setAttribute( 'aria-checked', b === accent ? 'true' : 'false' ) );
				setPref( { accent: accent.dataset.accentChoice } );
				return;
			}
			const theme = e.target.closest( '[data-theme-choice]' );
			if ( theme ) {
				pop.querySelectorAll( '[data-theme-choice]' ).forEach( ( b ) => b.setAttribute( 'aria-checked', b === theme ? 'true' : 'false' ) );
				setPref( { theme: theme.dataset.themeChoice } );
				return;
			}
			const act = e.target.closest( '[data-do]' );
			if ( act ) {
				UI.closePopover();
				( { shortcuts: openShortcuts, export: exportAll, import: importNotes }[ act.dataset.do ] || ( () => {} ) )();
			}
		} );
		pop.addEventListener( 'change', ( e ) => {
			const el = e.target.closest( '[data-pref]' );
			if ( el ) {
				setPref( { [ el.dataset.pref ]: el.type === 'checkbox' ? el.checked : el.value } );
			}
		} );
	}

	function openShortcuts() {
		const section = ( title, rows ) =>
			'<section class="nf-keys"><h3>' + esc( title ) + '</h3><dl>' +
			rows.map( ( r ) => '<div><dt>' + esc( r[ 0 ] ) + '</dt><dd><kbd>' + esc( r[ 1 ] ) + '</kbd></dd></div>' ).join( '' ) +
			'</dl></section>';
		UI.dialog( {
			title: __( 'Keyboard Shortcuts', 'noteflow' ),
			wide: true,
			body:
				'<div class="nf-keys-grid">' +
				section( __( 'Notes', 'noteflow' ), [
					[ __( 'New note', 'noteflow' ), 'N' ],
					[ __( 'Search', 'noteflow' ), '/' ],
					[ __( 'Previous or next note', 'noteflow' ), '↑ ↓' ],
					[ __( 'Edit the selected note', 'noteflow' ), 'Enter' ],
					[ __( 'Pin or unpin', 'noteflow' ), 'P' ],
					[ __( 'Delete note', 'noteflow' ), isMac ? '⌫' : 'Delete' ],
					[ __( 'Save now', 'noteflow' ), MOD + 'S' ],
					[ __( 'Show shortcuts', 'noteflow' ), '?' ],
				] ) +
				section( __( 'Formatting', 'noteflow' ), [
					[ __( 'Title, heading, subheading', 'noteflow' ), MOD + ALT + '1 2 3' ],
					[ __( 'Body text', 'noteflow' ), MOD + ALT + '0' ],
					[ __( 'Monospaced', 'noteflow' ), MOD + ALT + '9' ],
					[ __( 'Checklist', 'noteflow' ), MOD + SHIFT + 'L' ],
					[ __( 'Bulleted list', 'noteflow' ), MOD + SHIFT + '8' ],
					[ __( 'Numbered list', 'noteflow' ), MOD + SHIFT + '7' ],
					[ __( 'Bold, italic, underline', 'noteflow' ), MOD + 'B I U' ],
					[ __( 'Strikethrough', 'noteflow' ), MOD + SHIFT + 'X' ],
					[ __( 'Highlight', 'noteflow' ), MOD + SHIFT + 'H' ],
					[ __( 'Inline code', 'noteflow' ), MOD + 'E' ],
					[ __( 'Link', 'noteflow' ), MOD + 'K' ],
					[ __( 'Indent a list item', 'noteflow' ), 'Tab' ],
				] ) +
				section( __( 'Type at the start of a line', 'noteflow' ), [
					[ __( 'Title', 'noteflow' ), '# ' ],
					[ __( 'Heading', 'noteflow' ), '## ' ],
					[ __( 'Bulleted list', 'noteflow' ), '- ' ],
					[ __( 'Dashed list', 'noteflow' ), '-- ' ],
					[ __( 'Numbered list', 'noteflow' ), '1. ' ],
					[ __( 'Checklist', 'noteflow' ), '[] ' ],
					[ __( 'Quote', 'noteflow' ), '> ' ],
					[ __( 'Code block', 'noteflow' ), '``` ' ],
				] ) +
				'</div>',
			actions: [ { label: __( 'Done', 'noteflow' ), primary: true } ],
		} );
	}

	/* Link suggestions: notes, posts, pages and any post type ---------------------------- */

	function linkItemHTML( item, active ) {
		const meta = [ item.type, item.status ? statusLabel( item.status ) : '' ].filter( Boolean ).join( ' · ' );
		return (
			'<li role="option" aria-selected="' + active + '"><button type="button" class="nf-link-item' + ( active ? ' is-active' : '' ) + '" data-url="' + esc( item.url ) + '" data-title="' + esc( item.title ) + '">' +
			icon( item.kind === 'note' ? 'notes' : 'file', 16 ) +
			'<span><strong>' + esc( item.title ) + '</strong><span>' + esc( meta ) + '</span></span></button></li>'
		);
	}

	/** Searches linkable items; resolves to a list. */
	const findLinks = ( () => {
		let token = 0;
		return async ( search ) => {
			const mine = ++token;
			try {
				const res = await api.get( '/links', { search } );
				return mine === token ? res.items : null;
			} catch ( err ) {
				return mine === token ? [] : null;
			}
		};
	} )();

	/** The list that follows [[ in the editor. */
	const linkSuggest = ( () => {
		let el = null;
		let items = [];
		let active = 0;
		let timer = null;

		const close = () => {
			clearTimeout( timer );
			if ( el ) {
				el.remove();
				el = null;
			}
			items = [];
		};

		const render = ( rect ) => {
			if ( ! el ) {
				el = document.createElement( 'div' );
				el.className = 'nf-link-suggest';
				el.setAttribute( 'role', 'listbox' );
				el.setAttribute( 'aria-label', __( 'Link to', 'noteflow' ) );
				$( '.nf-layer' ).appendChild( el );
				el.addEventListener( 'mousedown', ( e ) => {
					const btn = e.target.closest( '[data-url]' );
					if ( btn ) {
						e.preventDefault();
						editor.insertLinkFromQuery( btn.dataset.url, btn.dataset.title );
					}
				} );
			}
			el.innerHTML = items.length
				? '<p class="nf-link-suggest-head">' + esc( __( 'Link to…', 'noteflow' ) ) + '</p><ul>' + items.map( ( item, i ) => linkItemHTML( item, i === active ) ).join( '' ) + '</ul>'
				: '<p class="nf-link-suggest-empty">' + esc( __( 'Type to search notes, posts and pages.', 'noteflow' ) ) + '</p>';
			if ( rect ) {
				const top = rect.bottom + 6;
				el.style.left = Math.min( Math.max( 8, rect.left ), window.innerWidth - 340 ) + 'px';
				el.style.top = ( top + 280 > window.innerHeight ? Math.max( 8, rect.top - 290 ) : top ) + 'px';
			}
		};

		return {
			query( q ) {
				if ( ! q ) {
					close();
					return;
				}
				render( q.rect );
				clearTimeout( timer );
				timer = setTimeout( async () => {
					const found = await findLinks( q.query );
					if ( found && editor.linkQuery ) {
						items = found.slice( 0, 8 );
						active = 0;
						render( null );
					}
				}, 140 );
			},
			key( e ) {
				if ( ! el ) {
					return false;
				}
				if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
					if ( items.length ) {
						active = ( active + ( e.key === 'ArrowDown' ? 1 : -1 ) + items.length ) % items.length;
						render( null );
					}
					return true;
				}
				if ( ( e.key === 'Enter' || e.key === 'Tab' ) && items[ active ] ) {
					editor.insertLinkFromQuery( items[ active ].url, items[ active ].title );
					return true;
				}
				if ( e.key === 'Escape' ) {
					editor.closeLinkQuery();
					return true;
				}
				return false;
			},
		};
	} )();

	/** Links to other notes open in the app instead of a new tab. */
	function openInternalLink( href ) {
		try {
			const url = new URL( href, window.location.href );
			const app = new URL( data.urls.app, window.location.href );
			const id = Number( url.searchParams.get( 'note' ) );
			if ( id && url.origin === app.origin && url.pathname === app.pathname && url.searchParams.get( 'page' ) === app.searchParams.get( 'page' ) ) {
				goToNote( id );
				return true;
			}
		} catch ( err ) {}
		return false;
	}

	/* Link editor ----------------------------------------------------------------------------- */

	function openLinkEditor() {
		const cur = S.current;
		if ( ! cur || cur.readOnly || S.preview ) {
			return;
		}
		const st = editor.state() || {};
		const needsText = ! editor.selectedText() && ! st.link;
		const anchor = toolbarEl.querySelector( '[data-action="link"]' ) || toolbarEl;
		const pop = UI.popover(
			anchor,
			'<form class="nf-link-form">' +
				'<label class="nf-field"><span>' + esc( __( 'Link address', 'noteflow' ) ) + '</span><input type="text" name="url" value="' + esc( st.link || '' ) + '" placeholder="https://" autocomplete="off" spellcheck="false"></label>' +
				( needsText ? '<label class="nf-field"><span>' + esc( __( 'Text', 'noteflow' ) ) + '</span><input type="text" name="text" autocomplete="off"></label>' : '' ) +
				'<div class="nf-popover-actions">' +
				( st.link ? '<button type="button" class="nf-button is-small is-plain" data-unlink>' + esc( __( 'Remove Link', 'noteflow' ) ) + '</button>' : '' ) +
				'<button type="submit" class="nf-button is-small is-primary">' + esc( __( 'Apply', 'noteflow' ) ) + '</button>' +
				'</div></form>',
			{ label: __( 'Link', 'noteflow' ), className: 'nf-link-pop' }
		);
		const urlInput = pop.querySelector( '[name="url"]' );
		const textInput = pop.querySelector( '[name="text"]' );
		const list = document.createElement( 'ul' );
		list.className = 'nf-link-results';
		list.setAttribute( 'role', 'listbox' );
		urlInput.closest( '.nf-field' ).after( list );
		urlInput.setAttribute( 'placeholder', __( 'Search or paste a link', 'noteflow' ) );
		let results = [];
		let active = -1;

		const looksLikeUrl = ( v ) => /^(https?:\/\/|www\.|mailto:|tel:|\/|#)/i.test( v ) || /^[^\s]+\.[a-z]{2,}(\/|$)/i.test( v );
		const renderResults = () => {
			list.innerHTML = results.map( ( item, i ) => linkItemHTML( item, i === active ) ).join( '' );
			list.hidden = ! results.length;
		};
		const pick = ( item ) => {
			UI.closePopover();
			editor.setLink( item.url, textInput && ! textInput.value.trim() ? item.title : ( textInput ? textInput.value.trim() : '' ) );
		};
		const search = debounce( async () => {
			const v = urlInput.value.trim();
			if ( looksLikeUrl( v ) ) {
				results = [];
				renderResults();
				return;
			}
			const found = await findLinks( v );
			if ( found ) {
				results = found.slice( 0, 8 );
				active = results.length ? 0 : -1;
				renderResults();
			}
		}, 160 );
		urlInput.addEventListener( 'input', search );
		urlInput.addEventListener( 'keydown', ( e ) => {
			if ( ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) && results.length ) {
				e.preventDefault();
				active = ( active + ( e.key === 'ArrowDown' ? 1 : -1 ) + results.length ) % results.length;
				renderResults();
			} else if ( e.key === 'Enter' && results[ active ] && ! looksLikeUrl( urlInput.value.trim() ) ) {
				e.preventDefault();
				pick( results[ active ] );
			}
		} );
		list.addEventListener( 'mousedown', ( e ) => {
			const btn = e.target.closest( '[data-url]' );
			if ( btn ) {
				e.preventDefault();
				pick( results.find( ( item ) => item.url === btn.dataset.url ) || { url: btn.dataset.url, title: btn.dataset.title } );
			}
		} );
		if ( ! st.link ) {
			search();
		}

		pop.querySelector( 'form' ).addEventListener( 'submit', ( e ) => {
			e.preventDefault();
			const url = urlInput.value.trim();
			UI.closePopover();
			if ( url ) {
				editor.setLink( url, textInput ? textInput.value.trim() : '' );
			}
		} );
		const unlink = pop.querySelector( '[data-unlink]' );
		if ( unlink ) {
			unlink.addEventListener( 'click', () => {
				UI.closePopover();
				editor.setLink( '' );
			} );
		}
	}

	/* Comments and history -------------------------------------------------------------------- */

	function openActivity( tab ) {
		if ( ! S.current ) {
			return;
		}
		S.activity = tab || ( settings.comments ? 'comments' : 'history' );
		activityEl.hidden = false;
		applyPanes();
		renderToolbar();
		renderActivity();
		loadActivity();
		if ( S.activity === 'comments' && S.current.note.can.comment ) {
			setTimeout( () => commentInput.focus(), 50 );
		}
	}

	function closeActivity() {
		if ( S.preview ) {
			closePreview();
		}
		S.activity = '';
		activityEl.hidden = true;
		applyPanes();
		renderToolbar();
	}

	function mentionize( comment ) {
		let html = esc( comment.text ).replace( /\n/g, '<br>' );
		( comment.mentions || [] ).forEach( ( uid ) => {
			const name = esc( person( uid ).name );
			html = html.split( '@' + name ).join( '<span class="nf-mention">@' + name + '</span>' );
		} );
		return html;
	}

	function renderActivity() {
		const cur = S.current;
		if ( ! S.activity || ! cur ) {
			activityEl.hidden = true;
			return;
		}
		const tabs = [ settings.comments && [ 'comments', __( 'Comments', 'noteflow' ) ], [ 'history', __( 'History', 'noteflow' ) ] ].filter( Boolean );
		activityHead.innerHTML =
			'<div class="nf-tabs" role="tablist">' +
			tabs
				.map(
					( t ) =>
						'<button type="button" role="tab" aria-selected="' + ( S.activity === t[ 0 ] ) + '" data-tab="' + t[ 0 ] + '">' + esc( t[ 1 ] ) +
						( t[ 0 ] === 'comments' && cur.note.comments ? ' <span class="nf-tab-count">' + cur.note.comments + '</span>' : '' ) + '</button>'
				)
				.join( '' ) +
			'</div>' +
			'<button type="button" class="nf-icon-button" data-activity-close aria-label="' + esc( __( 'Close', 'noteflow' ) ) + '">' + icon( 'close', 16 ) + '</button>';

		let body = '';
		if ( S.activity === 'comments' ) {
			if ( S.comments.length ) {
				body =
					'<ul class="nf-comments">' +
					S.comments
						.map( ( c ) => {
							const p = person( c.author );
							const canDelete = c.author === me.id || cur.note.role === 'owner';
							return (
								'<li class="nf-comment">' + UI.avatar( p, 28 ) +
								'<div class="nf-comment-main"><div class="nf-comment-head"><strong>' + esc( p.name ) + '</strong><time title="' + esc( UI.fullDate( c.time ) ) + '">' + esc( UI.ago( c.time ) ) + '</time>' +
								( canDelete ? '<button type="button" class="nf-icon-button is-small" data-delete-comment="' + c.id + '" aria-label="' + esc( __( 'Delete comment', 'noteflow' ) ) + '" title="' + esc( __( 'Delete comment', 'noteflow' ) ) + '">' + icon( 'trash', 13 ) + '</button>' : '' ) +
								'</div><p>' + mentionize( c ) + '</p></div></li>'
							);
						} )
						.join( '' ) +
					'</ul>';
			} else if ( S.loadingActivity ) {
				body = '<p class="nf-activity-loading">' + esc( __( 'Loading…', 'noteflow' ) ) + '</p>';
			} else {
				body =
					'<div class="nf-activity-empty">' + icon( 'comment', 28 ) + '<p>' + esc( __( 'No comments yet', 'noteflow' ) ) + '</p><span>' +
					esc( isShared( cur.note ) ? __( 'Talk about this note here. Type @ to mention someone who can see it.', 'noteflow' ) : __( 'Share the note to discuss it with your team, or leave yourself a comment.', 'noteflow' ) ) +
					'</span></div>';
			}
		} else if ( S.revisions.length ) {
			body =
				'<p class="nf-activity-hint">' + esc( __( 'NoteFlow keeps a version every ten minutes while someone edits, and each time a different person makes changes.', 'noteflow' ) ) + '</p>' +
				'<ul class="nf-revisions">' +
				S.revisions
					.map( ( r ) => {
						const p = person( r.author );
						return (
							'<li><button type="button" class="nf-revision' + ( S.preview && S.preview.id === r.id ? ' is-active' : '' ) + '" data-revision="' + r.id + '">' + UI.avatar( p, 28 ) +
							'<span class="nf-revision-text"><strong>' + esc( UI.mediumDate( r.time ) ) + '</strong><span>' + esc( p.name ) + ( r.current ? ' · ' + esc( __( 'Current version', 'noteflow' ) ) : '' ) + '</span></span></button></li>'
						);
					} )
					.join( '' ) +
				'</ul>';
		} else if ( S.loadingActivity ) {
			body = '<p class="nf-activity-loading">' + esc( __( 'Loading…', 'noteflow' ) ) + '</p>';
		} else {
			body = '<div class="nf-activity-empty">' + icon( 'history', 28 ) + '<p>' + esc( __( 'No earlier versions yet', 'noteflow' ) ) + '</p><span>' + esc( __( 'Versions appear here as the note changes.', 'noteflow' ) ) + '</span></div>';
		}
		activityBody.innerHTML = body;
		commentForm.hidden = ! ( S.activity === 'comments' && cur.note.can.comment );
		if ( S.activity === 'comments' ) {
			activityBody.scrollTop = activityBody.scrollHeight;
		}
	}

	async function loadActivity() {
		const cur = S.current;
		if ( ! cur || ! S.activity ) {
			return;
		}
		const tab = S.activity;
		S.loadingActivity = true;
		renderActivity();
		try {
			if ( tab === 'comments' ) {
				const res = await api.get( '/notes/' + cur.id + '/comments' );
				if ( S.current !== cur ) {
					return;
				}
				Object.assign( S.people, res.people || {} );
				S.comments = res.comments;
				cur.note.comments = res.comments.length;
				const summary = S.notes.get( cur.id );
				if ( summary ) {
					summary.comments = res.comments.length;
				}
			} else {
				const res = await api.get( '/notes/' + cur.id + '/revisions' );
				if ( S.current !== cur ) {
					return;
				}
				Object.assign( S.people, res.people || {} );
				S.revisions = res.revisions;
			}
		} catch ( err ) {
			failed( err );
		} finally {
			S.loadingActivity = false;
		}
		if ( S.current === cur && S.activity === tab ) {
			renderActivity();
			renderToolbar();
		}
	}

	async function submitComment() {
		const cur = S.current;
		const text = commentInput.value.trim();
		if ( ! cur || ! text ) {
			return;
		}
		const mentions = Array.from( S.mentions ).filter( ( uid ) => text.includes( '@' + person( uid ).name ) );
		commentInput.disabled = true;
		try {
			const res = await api.post( '/notes/' + cur.id + '/comments', { text, mentions } );
			Object.assign( S.people, res.people || {} );
			S.comments.push( res.comment );
			cur.note.comments = S.comments.length;
			const summary = S.notes.get( cur.id );
			if ( summary ) {
				summary.comments = S.comments.length;
			}
			commentInput.value = '';
			S.mentions.clear();
			renderActivity();
			renderToolbar();
			renderList();
		} catch ( err ) {
			failed( err );
		} finally {
			commentInput.disabled = false;
			commentInput.focus();
		}
	}

	async function deleteComment( cid ) {
		const cur = S.current;
		if ( ! cur ) {
			return;
		}
		const ok = await UI.confirm( { title: __( 'Delete this comment?', 'noteflow' ), confirm: __( 'Delete', 'noteflow' ), danger: true } );
		if ( ! ok ) {
			return;
		}
		try {
			await api.del( '/notes/' + cur.id + '/comments/' + cid );
			S.comments = S.comments.filter( ( c ) => c.id !== cid );
			cur.note.comments = S.comments.length;
			renderActivity();
			renderToolbar();
		} catch ( err ) {
			failed( err );
		}
	}

	/* @mentions in the comment box */

	let mentionMatches = [];
	let mentionActive = 0;
	let mentionToken = 0;

	function mentionCandidates() {
		const cur = S.current;
		if ( ! cur ) {
			return [];
		}
		const ids = ( cur.note.collaborators || [] ).map( ( c ) => c.id );
		return ids.filter( ( id ) => id !== me.id ).map( person );
	}

	async function updateMentions() {
		const before = commentInput.value.slice( 0, commentInput.selectionStart );
		const match = before.match( /(^|\s)@([^\s@]{0,30})$/ );
		if ( ! match ) {
			mentionMatches = [];
			renderMentions();
			return;
		}
		const q = match[ 2 ].toLowerCase();
		let pool = mentionCandidates();
		if ( S.current && S.current.note.everyone ) {
			const mine = ++mentionToken;
			try {
				const res = await api.get( '/people', { search: q } );
				if ( mine !== mentionToken ) {
					return;
				}
				res.people.forEach( ( p ) => ( S.people[ p.id ] = p ) );
				pool = pool.concat( res.people.filter( ( p ) => ! pool.some( ( x ) => x.id === p.id ) ) );
			} catch ( err ) {}
		}
		mentionMatches = pool.filter( ( p ) => p.name.toLowerCase().includes( q ) ).slice( 0, 6 );
		mentionActive = 0;
		renderMentions();
	}

	function renderMentions() {
		mentionList.hidden = ! mentionMatches.length;
		mentionList.innerHTML = mentionMatches
			.map( ( p, i ) => '<li role="option" aria-selected="' + ( i === mentionActive ) + '"><button type="button" data-mention="' + p.id + '" class="' + ( i === mentionActive ? 'is-active' : '' ) + '">' + UI.avatar( p, 22 ) + esc( p.name ) + '</button></li>' )
			.join( '' );
	}

	function pickMention( id ) {
		const p = person( id );
		const pos = commentInput.selectionStart;
		const before = commentInput.value.slice( 0, pos ).replace( /@([^\s@]{0,30})$/, '@' + p.name + ' ' );
		commentInput.value = before + commentInput.value.slice( pos );
		commentInput.setSelectionRange( before.length, before.length );
		S.mentions.add( id );
		mentionMatches = [];
		renderMentions();
		commentInput.focus();
	}

	/* Version preview */

	async function previewRevision( rid ) {
		const cur = S.current;
		if ( ! cur ) {
			return;
		}
		await flushSave();
		try {
			const res = await api.get( '/notes/' + cur.id + '/revisions/' + rid );
			if ( S.current !== cur ) {
				return;
			}
			S.preview = res;
			editor.setContent( res.content );
			editor.setReadOnly( true );
			titleEl.value = res.title;
			titleEl.readOnly = true;
			autosizeTitle();
			app.classList.add( 'is-previewing' );
			renderBanners();
			renderToolbar();
			renderNoteMeta();
			renderActivity();
		} catch ( err ) {
			failed( err );
		}
	}

	function closePreview() {
		const cur = S.current;
		if ( ! S.preview || ! cur ) {
			return;
		}
		S.preview = null;
		app.classList.remove( 'is-previewing' );
		editor.setContent( cur.baseContent );
		editor.setReadOnly( cur.readOnly );
		titleEl.value = cur.baseTitle;
		titleEl.readOnly = cur.readOnly;
		autosizeTitle();
		renderBanners();
		renderToolbar();
		renderNoteMeta();
		renderActivity();
	}

	async function restorePreview() {
		const cur = S.current;
		const revision = S.preview;
		if ( ! cur || ! revision ) {
			return;
		}
		try {
			const res = await api.post( '/notes/' + cur.id + '/revisions/' + revision.id + '/restore' );
			Object.assign( S.people, res.people || {} );
			S.preview = null;
			app.classList.remove( 'is-previewing' );
			loadIntoEditor( res.note, { keepActivity: true } );
			UI.toast( __( 'Version restored.', 'noteflow' ) );
		} catch ( err ) {
			failed( err );
		}
	}

	/* Events ------------------------------------------------------------------------------------ */

	function handleAction( action, el ) {
		const cur = S.current;
		switch ( action ) {
			case 'compose':
				newNote();
				break;
			case 'templates':
				templatesMenu( el );
				break;
			case 'notifications':
				openNotifications( el );
				break;
			case 'prefs':
				openPrefs( el );
				break;
			case 'new-folder':
				newFolder();
				break;
			case 'folder-menu':
				folderMenu( el, S.view.slice( 7 ) );
				break;
			case 'toggle-layout':
				setPref( { view: S.prefs.view === 'gallery' ? 'list' : 'gallery' } );
				break;
			case 'sort-menu':
				sortMenu( el );
				break;
			case 'toggle-sidebar':
				setPref( { collapsed: ! S.prefs.collapsed } );
				break;
			case 'show-sidebar':
				S.pane = 'sidebar';
				applyPanes();
				break;
			case 'back':
				S.pane = 'list';
				S.galleryOpen = false;
				applyPanes();
				renderList();
				break;
			case 'format':
				formatMenu( el );
				break;
			case 'checklist':
				editor.toggleList( 'check' );
				break;
			case 'table':
				tableMenu( el );
				break;
			case 'image':
				insertImageFromLibrary();
				break;
			case 'link':
				openLinkEditor();
				break;
			case 'share':
				openShare();
				break;
			case 'activity':
				if ( S.activity ) {
					closeActivity();
				} else {
					openActivity();
				}
				break;
			case 'more':
				if ( cur ) {
					noteMenu( el, cur.id );
				}
				break;
			case 'recover':
				if ( cur ) {
					restoreNote( cur.id, true );
				}
				break;
			case 'empty-trash':
				emptyTrash();
				break;
			case 'dismiss-upgrade':
				S.upgradeDismissed = true;
				renderNotices();
				api.post( '/dismiss', { what: 'upgrade' } ).catch( () => {} );
				break;
			case 'review':
			case 'review-done':
				S.reviewDismissed = true;
				setTimeout( renderNotices );
				api.post( '/dismiss', { what: 'review' } ).catch( () => {} );
				if ( action === 'review' ) {
					UI.toast( __( 'Thank you! It really helps.', 'noteflow' ) );
				}
				break;
			case 'review-later':
				S.reviewDismissed = true;
				renderNotices();
				api.post( '/dismiss', { what: 'review', later: 1 } ).catch( () => {} );
				break;
			case 'conflict-mine':
				keepMine();
				break;
			case 'conflict-theirs':
				useTheirs();
				break;
			case 'preview-restore':
				restorePreview();
				break;
			case 'preview-close':
				closePreview();
				break;
			case 'reminder':
				if ( cur && canEdit( cur.note ) && ! cur.readOnly ) {
					reminderDialog( cur.id );
				}
				break;
			case 'remove-reminder':
				if ( cur ) {
					setReminder( cur.id, 0 );
				}
				break;
			case 'remove-link':
				if ( cur ) {
					linkTo( cur.id, 0 );
				}
				break;
			case 'reload':
				window.location.reload();
				break;
		}
	}

	app.addEventListener( 'click', ( e ) => {
		if ( e.target.closest( '.nf-layer' ) ) {
			return;
		}
		const row = e.target.closest( '.nf-list [data-id]' );
		if ( row ) {
			listEl.focus( { preventScroll: true } );
			selectNote( Number( row.dataset.id ) );
			return;
		}
		const view = e.target.closest( '[data-view]' );
		if ( view && app.contains( view ) ) {
			setView( view.dataset.view );
			return;
		}
		const action = e.target.closest( '[data-action]' );
		if ( action && app.contains( action ) ) {
			handleAction( action.dataset.action, action );
		}
	} );

	// Keep the editor's selection when clicking formatting buttons.
	toolbarEl.addEventListener( 'mousedown', ( e ) => {
		if ( e.target.closest( '.nf-format button' ) ) {
			e.preventDefault();
		}
	} );

	listEl.addEventListener( 'contextmenu', ( e ) => {
		const target = e.target.closest( '[data-id]' );
		if ( target ) {
			e.preventDefault();
			noteMenu( { x: e.clientX, y: e.clientY }, Number( target.dataset.id ) );
		}
	} );

	sidebarEl.addEventListener( 'contextmenu', ( e ) => {
		const folder = e.target.closest( '[data-folder]' );
		if ( folder ) {
			e.preventDefault();
			folderMenu( { x: e.clientX, y: e.clientY }, folder.dataset.folder );
		}
	} );

	sidebarEl.addEventListener( 'dblclick', ( e ) => {
		const folder = e.target.closest( '[data-folder]' );
		if ( folder ) {
			renameFolder( folder.dataset.folder );
		}
	} );

	// Drag a note onto a folder to move it.
	listEl.addEventListener( 'dragstart', ( e ) => {
		const target = e.target.closest( '[data-id]' );
		if ( target ) {
			e.dataTransfer.setData( 'text/x-noteflow', target.dataset.id );
			e.dataTransfer.effectAllowed = 'move';
		}
	} );
	sidebarEl.addEventListener( 'dragover', ( e ) => {
		const target = e.target.closest( '[data-drop]' );
		if ( target && Array.from( e.dataTransfer.types ).includes( 'text/x-noteflow' ) ) {
			e.preventDefault();
			target.classList.add( 'is-drop' );
		}
	} );
	sidebarEl.addEventListener( 'dragleave', ( e ) => {
		const target = e.target.closest( '[data-drop]' );
		if ( target ) {
			target.classList.remove( 'is-drop' );
		}
	} );
	sidebarEl.addEventListener( 'drop', ( e ) => {
		const target = e.target.closest( '[data-drop]' );
		if ( ! target ) {
			return;
		}
		e.preventDefault();
		target.classList.remove( 'is-drop' );
		const id = Number( e.dataTransfer.getData( 'text/x-noteflow' ) );
		if ( id ) {
			moveTo( id, target.dataset.drop );
		}
	} );

	listEl.addEventListener( 'keydown', ( e ) => {
		const ids = Array.from( listEl.querySelectorAll( '[data-id]' ) ).map( ( el ) => Number( el.dataset.id ) );
		const index = ids.indexOf( S.selected );
		const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ e.key ];

		if ( step ) {
			if ( ( e.key === 'ArrowLeft' || e.key === 'ArrowRight' ) && S.prefs.view !== 'gallery' ) {
				return;
			}
			e.preventDefault();
			const next = ids[ Math.min( ids.length - 1, Math.max( 0, index + step ) ) ];
			if ( next && next !== S.selected ) {
				openNote( next );
				const el = listEl.querySelector( '[data-id="' + next + '"]' );
				if ( el ) {
					el.scrollIntoView( { block: 'nearest' } );
				}
			}
		} else if ( e.key === 'Enter' && S.current ) {
			e.preventDefault();
			showEditorPane();
			if ( ! S.current.readOnly ) {
				editor.focus( 'end' );
			}
		} else if ( ( e.key === 'Delete' || e.key === 'Backspace' ) && S.selected ) {
			const n = S.notes.get( S.selected );
			if ( n && n.role === 'owner' ) {
				e.preventDefault();
				if ( n.status === 'trash' ) {
					deleteForever( n.id );
				} else {
					trashNote( n.id );
				}
			}
		} else if ( e.key.toLowerCase() === 'p' && ! e.metaKey && ! e.ctrlKey && ! e.altKey && S.selected && S.view !== 'trash' ) {
			e.preventDefault();
			togglePin( S.selected );
		}
	} );

	document.addEventListener( 'keydown', ( e ) => {
		if ( e.defaultPrevented ) {
			return;
		}
		const modKey = isMac ? e.metaKey : e.ctrlKey;
		const typing = e.target.closest && e.target.closest( 'input, textarea, select, [contenteditable="true"]' );

		if ( modKey && ! e.altKey && ! e.shiftKey && e.key.toLowerCase() === 's' && S.current ) {
			e.preventDefault();
			flushSave().then( () => S.current && ! S.current.readOnly && setSaveState( 'saved' ) );
			return;
		}
		if ( modKey && e.altKey && e.code === 'KeyF' ) {
			e.preventDefault();
			searchInput.focus();
			return;
		}
		if ( typing || UI.hasDialog() || UI.isMenuOpen() || e.metaKey || e.ctrlKey || e.altKey ) {
			return;
		}
		if ( e.key === 'n' || e.key === 'N' ) {
			if ( S.view !== 'trash' ) {
				e.preventDefault();
				newNote();
			}
		} else if ( e.key === '/' ) {
			e.preventDefault();
			searchInput.focus();
		} else if ( e.key === '?' ) {
			e.preventDefault();
			openShortcuts();
		}
	} );

	listEl.addEventListener( 'focus', () => listEl.classList.add( 'is-focused' ) );
	listEl.addEventListener( 'blur', () => listEl.classList.remove( 'is-focused' ) );

	const runSearch = debounce( async ( q ) => {
		S.search = q;
		S.results = null;
		renderSidebar();
		renderList();
		if ( q.length < 2 ) {
			return;
		}
		const mine = ++runSearch.token;
		try {
			const res = await api.get( '/notes', { search: q } );
			if ( mine !== runSearch.token || S.search !== q ) {
				return;
			}
			S.results = new Map( res.results.map( ( r ) => [ r.id, r.snippet ] ) );
			renderList();
		} catch ( err ) {}
	}, 150 );
	runSearch.token = 0;

	searchInput.addEventListener( 'input', () => runSearch( searchInput.value.trim() ) );
	searchInput.addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'Escape' ) {
			searchInput.value = '';
			runSearch( '' );
			searchInput.blur();
		} else if ( e.key === 'ArrowDown' || e.key === 'Enter' ) {
			const first = visible()[ 0 ];
			if ( first ) {
				e.preventDefault();
				listEl.focus();
				openNote( first.id );
			}
		}
	} );

	titleEl.addEventListener( 'input', () => {
		if ( titleEl.value.includes( '\n' ) ) {
			titleEl.value = titleEl.value.replace( /\n/g, ' ' );
		}
		autosizeTitle();
		onEdit();
		const cur = S.current;
		const rowTitle = cur && listEl.querySelector( '[data-id="' + cur.id + '"] .nf-row-text, [data-id="' + cur.id + '"] .nf-card-title span' );
		if ( rowTitle ) {
			rowTitle.textContent = titleEl.value.trim() || __( 'New Note', 'noteflow' );
		}
	} );
	titleEl.addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'Enter' || ( e.key === 'ArrowDown' && titleEl.selectionStart === titleEl.value.length ) ) {
			e.preventDefault();
			editor.focus( 'start' );
		}
	} );

	activityEl.addEventListener( 'click', ( e ) => {
		const tab = e.target.closest( '[data-tab]' );
		if ( tab ) {
			if ( S.preview && tab.dataset.tab !== 'history' ) {
				closePreview();
			}
			S.activity = tab.dataset.tab;
			renderActivity();
			loadActivity();
			return;
		}
		if ( e.target.closest( '[data-activity-close]' ) ) {
			closeActivity();
			return;
		}
		const del = e.target.closest( '[data-delete-comment]' );
		if ( del ) {
			deleteComment( Number( del.dataset.deleteComment ) );
			return;
		}
		const rev = e.target.closest( '[data-revision]' );
		if ( rev ) {
			const revision = S.revisions.find( ( r ) => r.id === Number( rev.dataset.revision ) );
			if ( revision && revision.current ) {
				closePreview();
			} else {
				previewRevision( Number( rev.dataset.revision ) );
			}
			return;
		}
		const mention = e.target.closest( '[data-mention]' );
		if ( mention ) {
			pickMention( Number( mention.dataset.mention ) );
		}
	} );

	commentForm.addEventListener( 'submit', ( e ) => {
		e.preventDefault();
		submitComment();
	} );
	commentInput.addEventListener( 'input', updateMentions );
	commentInput.addEventListener( 'keydown', ( e ) => {
		if ( mentionMatches.length ) {
			if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
				e.preventDefault();
				mentionActive = ( mentionActive + ( e.key === 'ArrowDown' ? 1 : -1 ) + mentionMatches.length ) % mentionMatches.length;
				renderMentions();
				return;
			}
			if ( e.key === 'Enter' || e.key === 'Tab' ) {
				e.preventDefault();
				pickMention( mentionMatches[ mentionActive ].id );
				return;
			}
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				mentionMatches = [];
				renderMentions();
				return;
			}
		}
		if ( e.key === 'Enter' && ( e.metaKey || e.ctrlKey ) ) {
			e.preventDefault();
			submitComment();
		}
	} );

	document.addEventListener( 'visibilitychange', () => {
		if ( document.hidden ) {
			flushSave();
		} else {
			scheduleSync( 200 );
		}
	} );

	window.addEventListener( 'beforeunload', ( e ) => {
		const cur = S.current;
		if ( ! cur || cur.readOnly || cur.conflict || ( cur.changeSeq === cur.savedSeq && ! saving ) ) {
			return;
		}
		// Send the last changes in a request that outlives the page.
		const nonce = ( wp.apiFetch.nonceMiddleware && wp.apiFetch.nonceMiddleware.nonce ) || '';
		try {
			fetch( data.urls.notesApi + cur.id, {
				method: 'POST',
				keepalive: true,
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
				body: JSON.stringify( { title: titleEl.value, content: editor.getContent(), base_version: cur.version } ),
			} );
		} catch ( err ) {}
		if ( S.saveState === 'error' || S.saveState === 'offline' ) {
			e.preventDefault();
			e.returnValue = '';
		}
	} );

	window.addEventListener( 'resize', debounce( () => {
		if ( ! isMobile() ) {
			S.pane = 'list';
		}
		applyPanes();
	}, 100 ) );

	/* Start ------------------------------------------------------------------------------------ */

	function start() {
		applyTheme();
		fitHeight();

		const st = data.start || {};
		if ( st.folder ) {
			const view = st.folder.indexOf( 'folder-' ) === 0 ? 'folder:' + st.folder.slice( 7 ) : st.folder;
			if ( [ 'shared', 'reminders', 'notes', 'trash' ].includes( view ) || ( view.indexOf( 'folder:' ) === 0 && folderExists( view.slice( 7 ) ) ) ) {
				S.view = view;
			}
		}
		const target = st.note && S.notes.get( st.note );
		if ( target && ! inView( target ) ) {
			S.view = target.status === 'trash' ? 'trash' : 'all';
		}

		renderAll();
		mount.classList.add( 'is-ready' );

		if ( st.new ) {
			newNote();
		} else if ( target ) {
			openNote( target.id );
			const el = listEl.querySelector( '[data-id="' + target.id + '"]' );
			if ( el ) {
				el.scrollIntoView( { block: 'nearest' } );
			}
		} else {
			if ( st.note ) {
				UI.toast( __( 'That note is gone, or it is no longer shared with you.', 'noteflow' ), { error: true } );
			}
			openFirst();
		}
		scheduleSync( 5000 );
	}

	start();
}() );
