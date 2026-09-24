/**
 * NoteFlow discussions: comments and issues on a post, like in a shared document.
 *
 * window.NoteFlowDiscussion renders the panel into an element. The block editor
 * passes an `editor` object so threads can be attached to blocks; the classic editor
 * uses the panel without it.
 */
( function () {
	'use strict';

	const { __, _n, sprintf } = wp.i18n;
	const NS = '/noteflow/v1';
	const COLORS = [ '#e07a5f', '#3d8bfd', '#8e6cf1', '#20a386', '#e0a100', '#d6538b', '#4a90a4', '#7b8b3a' ];

	const esc = ( value ) =>
		String( value === null || value === undefined ? '' : value ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );

	function initials( name ) {
		const parts = String( name || '?' ).trim().split( /\s+/ );
		return ( ( parts[ 0 ] || '?' )[ 0 ] + ( parts.length > 1 ? parts[ parts.length - 1 ][ 0 ] : '' ) ).toUpperCase();
	}

	function avatar( person, size ) {
		const img = person && person.avatar ? '<img src="' + esc( person.avatar ) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
		return '<span class="nfd-avatar" style="--size:' + ( size || 24 ) + 'px;--avatar:' + COLORS[ ( person ? person.id : 0 ) % COLORS.length ] + '" aria-hidden="true"><span>' + esc( initials( person ? person.name : '?' ) ) + '</span>' + img + '</span>';
	}

	function ago( ts ) {
		const diff = Math.round( Date.now() / 1000 - ts );
		if ( diff < 45 ) {
			return __( 'just now', 'noteflow' );
		}
		if ( diff < 3600 ) {
			/* translators: %d: minutes. */
			return sprintf( __( '%d min ago', 'noteflow' ), Math.max( 1, Math.round( diff / 60 ) ) );
		}
		if ( diff < 86400 ) {
			/* translators: %d: hours. */
			return sprintf( __( '%d hr ago', 'noteflow' ), Math.round( diff / 3600 ) );
		}
		return new Intl.DateTimeFormat( document.documentElement.lang || undefined, { day: 'numeric', month: 'short' } ).format( new Date( ts * 1000 ) );
	}

	const ICONS = {
		comment: '<path d="M20.5 11.6a8.1 8.1 0 0 1-11.7 7.3L3.5 20.5l1.7-4.8a8.1 8.1 0 1 1 15.3-4.1Z"/>',
		issue: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
		check: '<path d="M20 6.5 9.2 17.3 4 12"/>',
		reopen: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.4"/><path d="M3.5 3.8v4.6h4.6"/>',
		trash: '<path d="M3.5 6h17M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M18.5 6l-.8 13a2 2 0 0 1-2 2H8.3a2 2 0 0 1-2-2L5.5 6"/>',
		block: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 10h9M7.5 14h6"/>',
		close: '<path d="M18 6 6 18M6 6l12 12"/>',
		note: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
		user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/>',
	};

	const icon = ( name, size ) =>
		'<svg class="nfd-icon" viewBox="0 0 24 24" width="' + ( size || 16 ) + '" height="' + ( size || 16 ) + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[ name ] + '</svg>';

	const api = ( path, options ) => wp.apiFetch( Object.assign( { path: NS + path }, options || {} ) );

	class Discussion {
		/**
		 * @param {HTMLElement} root    Container.
		 * @param {Object}      config  From PHP: post, me, people, moderate, discussions, notes, app, thread, type.
		 * @param {Object|null} editor  Block editor bridge, or null in the classic editor.
		 */
		constructor( root, config, editor ) {
			this.root = root;
			this.config = config;
			this.editor = editor || null;
			this.people = Object.assign( {}, config.people || {} );
			this.threads = [];
			this.notes = [];
			this.counts = { open: 0, resolved: 0 };
			this.filter = 'open';
			this.tab = config.discussions ? 'discussion' : 'notes';
			this.kind = 'comment';
			this.anchor = null;
			this.drafts = {};
			this.mentions = new Set();
			this.candidates = [];
			this.loaded = false;
			this.onVisible = () => ! document.hidden && this.refresh();

			this.renderShell();
			this.bind();
			this.load( true );
			this.timer = setInterval( () => ! document.hidden && this.refresh(), 20000 );
			document.addEventListener( 'visibilitychange', this.onVisible );
			if ( this.editor ) {
				this.unsubscribe = this.editor.onSelect( ( clientId ) => {
					this.updateAnchorHint();
					this.markCurrent( clientId, true );
				} );
			}
		}

		destroy() {
			clearInterval( this.timer );
			document.removeEventListener( 'visibilitychange', this.onVisible );
			if ( this.unsubscribe ) {
				this.unsubscribe();
			}
			this.root.innerHTML = '';
		}

		person( id ) {
			return this.people[ id ] || { id, name: __( 'Someone', 'noteflow' ), avatar: '' };
		}

		/* Rendering -------------------------------------------------------------------- */

		renderShell() {
			const c = this.config;
			const tabs = [];
			if ( c.discussions ) {
				tabs.push( '<button type="button" role="tab" data-tab="discussion">' + esc( __( 'Discussion', 'noteflow' ) ) + ' <span class="nfd-count" data-count="open"></span></button>' );
			}
			if ( c.notes ) {
				tabs.push( '<button type="button" role="tab" data-tab="notes">' + esc( __( 'Notes', 'noteflow' ) ) + ' <span class="nfd-count" data-count="notes"></span></button>' );
			}
			const placeholder = __( 'Add a comment. Type @ to mention someone.', 'noteflow' );
			this.root.innerHTML =
				'<div class="nfd">' +
				( tabs.length > 1 ? '<div class="nfd-tabs" role="tablist">' + tabs.join( '' ) + '</div>' : '' ) +
				( c.discussions
					? '<section class="nfd-panel" data-panel="discussion">' +
					  '<div class="nfd-compose">' +
					  '<div class="nfd-kind" role="radiogroup" aria-label="' + esc( __( 'Type', 'noteflow' ) ) + '">' +
					  '<button type="button" role="radio" data-kind="comment">' + icon( 'comment', 14 ) + esc( __( 'Comment', 'noteflow' ) ) + '</button>' +
					  '<button type="button" role="radio" data-kind="issue">' + icon( 'issue', 14 ) + esc( __( 'Issue', 'noteflow' ) ) + '</button>' +
					  '</div>' +
					  '<div class="nfd-anchor" hidden></div>' +
					  '<div class="nfd-field"><textarea rows="3" placeholder="' + esc( placeholder ) + '" aria-label="' + esc( __( 'Comment', 'noteflow' ) ) + '"></textarea><ul class="nfd-mentions" role="listbox" hidden></ul></div>' +
					  '<div class="nfd-compose-row"><label class="nfd-assign" hidden><span class="screen-reader-text">' + esc( __( 'Assign to', 'noteflow' ) ) + '</span><select><option value="0">' + esc( __( 'Assign to…', 'noteflow' ) ) + '</option></select></label>' +
					  '<button type="button" class="button button-primary nfd-submit"></button></div>' +
					  '<p class="nfd-status" role="status"></p>' +
					  '</div>' +
					  '<div class="nfd-filter" role="radiogroup" aria-label="' + esc( __( 'Show', 'noteflow' ) ) + '">' +
					  '<button type="button" role="radio" data-filter="open"></button><button type="button" role="radio" data-filter="resolved"></button></div>' +
					  '<ul class="nfd-threads"></ul>' +
					  '</section>'
					: '' ) +
				( c.notes
					? '<section class="nfd-panel" data-panel="notes">' +
					  '<p class="nfd-intro">' + esc( sprintf( /* translators: %s: post type name. */ __( 'Notes attached to this %s. They are private until you share them in NoteFlow.', 'noteflow' ), ( c.type || '' ).toLowerCase() ) ) + '</p>' +
					  '<ul class="nfd-notes"></ul>' +
					  '<div class="nfd-note-form"><textarea rows="3" placeholder="' + esc( __( 'Add a note…', 'noteflow' ) ) + '" aria-label="' + esc( __( 'New note', 'noteflow' ) ) + '"></textarea>' +
					  '<div class="nfd-compose-row"><a class="nfd-open-app" href="' + esc( c.app ) + '" target="_blank" rel="noopener noreferrer">' + esc( __( 'Open NoteFlow', 'noteflow' ) ) + '</a><button type="button" class="button nfd-note-add">' + esc( __( 'Add note', 'noteflow' ) ) + '</button></div></div>' +
					  '</section>'
					: '' ) +
				'</div>';
			this.$ = ( sel ) => this.root.querySelector( sel );
			this.setKind( 'comment' );
			this.setTab( this.tab );
			this.updateAnchorHint();
		}

		setTab( tab ) {
			this.tab = tab;
			this.root.querySelectorAll( '[data-tab]' ).forEach( ( b ) => b.setAttribute( 'aria-selected', b.dataset.tab === tab ? 'true' : 'false' ) );
			this.root.querySelectorAll( '[data-panel]' ).forEach( ( p ) => ( p.hidden = p.dataset.panel !== tab ) );
		}

		setKind( kind ) {
			this.kind = kind;
			this.root.querySelectorAll( '[data-kind]' ).forEach( ( b ) => b.setAttribute( 'aria-checked', b.dataset.kind === kind ? 'true' : 'false' ) );
			const assign = this.$( '.nfd-assign' );
			if ( assign ) {
				assign.hidden = kind !== 'issue';
			}
			const submit = this.$( '.nfd-submit' );
			if ( submit ) {
				submit.textContent = kind === 'issue' ? __( 'Raise issue', 'noteflow' ) : __( 'Comment', 'noteflow' );
			}
		}

		/**
		 * Shows the block a new comment is attached to, or offers the selected block.
		 * Comments started from the block toolbar are attached; others only when asked.
		 */
		updateAnchorHint() {
			const box = this.$( '.nfd-anchor' );
			if ( ! box || ! this.editor ) {
				return;
			}
			if ( this.anchor && ! this.editor.exists( this.anchor.clientId ) ) {
				this.anchor = null;
			}
			const block = this.anchor || this.editor.selected();
			if ( ! block ) {
				box.hidden = true;
				box.innerHTML = '';
				return;
			}
			box.hidden = false;
			box.classList.toggle( 'is-attached', !! this.anchor );
			box.innerHTML =
				'<label><input type="checkbox"' + ( this.anchor ? ' checked' : '' ) + '> ' +
				esc( this.anchor ? __( 'Attached to', 'noteflow' ) : __( 'Attach to the selected block', 'noteflow' ) ) + '</label>' +
				'<span class="nfd-anchor-block">' + icon( 'block', 13 ) + '<span><strong>' + esc( block.label ) + '</strong>' + ( block.text ? ' ' + esc( block.text ) : '' ) + '</span></span>';
			box.querySelector( 'input' ).addEventListener( 'change', ( e ) => {
				this.anchor = e.target.checked ? block : null;
				this.updateAnchorHint();
			} );
		}

		/**
		 * Marks the threads on the selected block, like the active comment in a document.
		 *
		 * @param {string}  clientId Selected block.
		 * @param {boolean} scroll   Whether to bring the first one into view.
		 */
		markCurrent( clientId, scroll ) {
			const id = clientId && this.editor ? this.editor.anchorOf( clientId ) : '';
			let first = null;
			this.root.querySelectorAll( '.nfd-thread' ).forEach( ( li ) => {
				const on = !! id && li.dataset.block === id;
				li.classList.toggle( 'is-current', on );
				first = first || ( on ? li : null );
			} );
			if ( first && scroll && this.root.isConnected ) {
				first.scrollIntoView( { block: 'nearest' } );
			}
			return first;
		}

		renderCounts() {
			const open = this.$( '[data-count="open"]' );
			if ( open ) {
				open.textContent = this.counts.open ? this.counts.open : '';
			}
			const notes = this.$( '[data-count="notes"]' );
			if ( notes ) {
				notes.textContent = this.notes.length ? this.notes.length : '';
			}
			const filters = this.root.querySelectorAll( '[data-filter]' );
			filters.forEach( ( b ) => {
				const n = this.counts[ b.dataset.filter ] || 0;
				b.textContent = b.dataset.filter === 'open'
					? /* translators: %d: number of open threads. */ sprintf( __( 'Open (%d)', 'noteflow' ), n )
					: /* translators: %d: number of resolved threads. */ sprintf( __( 'Resolved (%d)', 'noteflow' ), n );
				b.setAttribute( 'aria-checked', b.dataset.filter === this.filter ? 'true' : 'false' );
			} );
			if ( this.editor ) {
				const anchors = {};
				this.threads.forEach( ( t ) => {
					if ( t.status === 'open' && t.block ) {
						anchors[ t.block ] = ( anchors[ t.block ] || 0 ) + 1;
					}
				} );
				this.editor.setState( anchors, this.counts.open );
			}
		}

		mention( text, ids ) {
			let html = esc( text ).replace( /\n/g, '<br>' );
			( ids || [] ).forEach( ( uid ) => {
				const name = esc( this.person( uid ).name );
				html = html.split( '@' + name ).join( '<span class="nfd-mention">@' + name + '</span>' );
			} );
			return html;
		}

		message( author, time, text, mentions, deleteAttr ) {
			const p = this.person( author );
			return (
				'<div class="nfd-msg">' + avatar( p, 26 ) +
				'<div class="nfd-msg-main"><div class="nfd-msg-head"><strong>' + esc( p.name ) + '</strong><time>' + esc( ago( time ) ) + '</time>' +
				( deleteAttr ? '<button type="button" class="nfd-icon-button nfd-msg-delete" ' + deleteAttr + ' aria-label="' + esc( __( 'Delete', 'noteflow' ) ) + '" title="' + esc( __( 'Delete', 'noteflow' ) ) + '">' + icon( 'trash', 13 ) + '</button>' : '' ) +
				'</div><p>' + this.mention( text, mentions ) + '</p></div></div>'
			);
		}

		renderThreads() {
			const list = this.$( '.nfd-threads' );
			if ( ! list ) {
				return;
			}
			// Keep reply drafts and focus across renders.
			list.querySelectorAll( '.nfd-reply textarea' ).forEach( ( t ) => ( this.drafts[ t.dataset.thread ] = t.value ) );
			const focused = document.activeElement && list.contains( document.activeElement ) && document.activeElement.dataset.thread;

			const threads = this.threads.filter( ( t ) => t.status === this.filter );
			if ( ! threads.length ) {
				list.innerHTML = '<li class="nfd-empty">' + icon( this.filter === 'open' ? 'comment' : 'check', 22 ) + '<span>' +
					esc( this.filter === 'open' ? ( this.loaded ? __( 'No open comments or issues. Start one above.', 'noteflow' ) : __( 'Loading…', 'noteflow' ) ) : __( 'Nothing resolved yet.', 'noteflow' ) ) +
					'</span></li>';
				return;
			}

			const me = this.config.me;
			list.innerHTML = threads
				.map( ( t ) => {
					const canDelete = t.author === me || this.config.moderate;
					const assignee = t.assignee ? this.person( t.assignee ) : null;
					return (
						'<li class="nfd-thread is-' + t.type + ' is-' + t.status + ( t.id === this.highlight ? ' is-highlighted' : '' ) + '" data-thread="' + t.id + '" data-block="' + esc( t.block ) + '">' +
						'<div class="nfd-thread-head">' +
						'<span class="nfd-badge is-' + t.type + '">' + icon( t.type === 'issue' ? 'issue' : 'comment', 12 ) + esc( t.type === 'issue' ? __( 'Issue', 'noteflow' ) : __( 'Comment', 'noteflow' ) ) + '</span>' +
						( assignee
							? '<span class="nfd-assignee">' + esc( t.assignee === me
								? __( 'Assigned to you', 'noteflow' )
								: sprintf( /* translators: %s: person's name. */ __( 'Assigned to %s', 'noteflow' ), assignee.name ) ) + '</span>'
							: '' ) +
						'<span class="nfd-spacer"></span>' +
						( t.status === 'open'
							? '<button type="button" class="nfd-icon-button nfd-resolve" data-resolve="' + t.id + '" aria-label="' + esc( __( 'Resolve', 'noteflow' ) ) + '" title="' + esc( __( 'Resolve', 'noteflow' ) ) + '">' + icon( 'check', 15 ) + '</button>'
							: '<button type="button" class="nfd-icon-button" data-reopen="' + t.id + '" aria-label="' + esc( __( 'Reopen', 'noteflow' ) ) + '" title="' + esc( __( 'Reopen', 'noteflow' ) ) + '">' + icon( 'reopen', 15 ) + '</button>' ) +
						'</div>' +
						( t.quote || t.block ? '<button type="button" class="nfd-quote" data-block="' + esc( t.block ) + '" ' + ( this.editor && t.block ? '' : 'disabled' ) + '>' + icon( 'block', 13 ) + '<q>' + esc( t.quote || __( 'A block in this post', 'noteflow' ) ) + '</q></button>' : '' ) +
						this.message( t.author, t.time, t.text, t.mentions, canDelete ? 'data-delete-thread="' + t.id + '"' : '' ) +
						t.replies.map( ( r ) => this.message( r.author, r.time, r.text, r.mentions, r.author === me || this.config.moderate ? 'data-delete-reply="' + r.id + '"' : '' ) ).join( '' ) +
						( t.status === 'resolved' && t.resolvedBy
							? /* translators: 1: person's name, 2: time, like "5 min ago". */ '<p class="nfd-resolved">' + icon( 'check', 13 ) + esc( sprintf( __( 'Resolved by %1$s, %2$s', 'noteflow' ), this.person( t.resolvedBy ).name, ago( t.resolvedAt ) ) ) + '</p>'
							: '' ) +
						'<div class="nfd-reply"><textarea rows="1" data-thread="' + t.id + '" placeholder="' + esc( __( 'Reply…', 'noteflow' ) ) + '" aria-label="' + esc( __( 'Reply', 'noteflow' ) ) + '">' + esc( this.drafts[ t.id ] || '' ) + '</textarea>' +
						'<button type="button" class="button nfd-reply-send" data-reply="' + t.id + '">' + esc( __( 'Reply', 'noteflow' ) ) + '</button></div>' +
						'</li>'
					);
				} )
				.join( '' );

			if ( this.editor ) {
				this.markCurrent( this.editor.selectedId(), false );
			}
			if ( focused ) {
				const again = list.querySelector( 'textarea[data-thread="' + focused + '"]' );
				if ( again ) {
					again.focus();
					again.setSelectionRange( again.value.length, again.value.length );
				}
			}
		}

		renderNotes() {
			const list = this.$( '.nfd-notes' );
			if ( ! list ) {
				return;
			}
			list.innerHTML = this.notes.length
				? this.notes
						.map(
							( n ) =>
								'<li><a href="' + esc( n.url ) + '" target="_blank" rel="noopener noreferrer">' + icon( 'note', 15 ) +
								'<span><strong>' + esc( n.title || __( 'New Note', 'noteflow' ) ) + '</strong>' +
								( n.excerpt ? '<span class="nfd-note-excerpt">' + esc( n.excerpt ) + '</span>' : '' ) +
								/* translators: %s: time since, like "5 mins". */ '<span class="nfd-note-meta">' + esc( sprintf( __( '%s ago', 'noteflow' ), n.when ) ) + '</span></span></a></li>'
						)
						.join( '' )
				: '<li class="nfd-empty">' + icon( 'note', 22 ) + '<span>' + esc( __( 'No notes yet.', 'noteflow' ) ) + '</span></li>';
		}

		/* Data ----------------------------------------------------------------------------- */

		apply( res ) {
			if ( res.people ) {
				Object.assign( this.people, res.people );
			}
			if ( res.threads ) {
				this.threads = res.threads;
				this.counts = res.counts || this.counts;
			}
			this.loaded = true;
			this.renderCounts();
			this.renderThreads();
		}

		async load( first ) {
			const post = this.config.post;
			try {
				const jobs = [];
				if ( this.config.discussions ) {
					jobs.push( api( '/posts/' + post + '/threads' ).then( ( res ) => this.apply( res ) ) );
				}
				if ( this.config.notes ) {
					jobs.push(
						api( '/posts/' + post + '/notes' ).then( ( res ) => {
							this.notes = res.notes;
							this.renderNotes();
							this.renderCounts();
						} )
					);
				}
				await Promise.all( jobs );
			} catch ( err ) {
				this.status( err && err.message, true );
			}
			if ( first ) {
				this.loadPeople();
				this.openDeepLink();
			}
		}

		refresh() {
			// Don't redraw while someone is typing a reply.
			const active = document.activeElement;
			if ( active && this.root.contains( active ) && active.tagName === 'TEXTAREA' && active.value ) {
				return;
			}
			this.load( false );
		}

		async loadPeople() {
			try {
				const res = await api( '/posts/' + this.config.post + '/people' );
				this.candidates = res.people.filter( ( p ) => p.id !== this.config.me );
				res.people.forEach( ( p ) => ( this.people[ p.id ] = p ) );
				const select = this.$( '.nfd-assign select' );
				if ( select ) {
					select.innerHTML = '<option value="0">' + esc( __( 'Assign to…', 'noteflow' ) ) + '</option>' + res.people.map( ( p ) => '<option value="' + p.id + '">' + esc( p.name + ( p.id === this.config.me ? ' ' + __( '(you)', 'noteflow' ) : '' ) ) + '</option>' ).join( '' );
				}
			} catch ( err ) {}
		}

		/** Opens the thread a notification or the posts list linked to. */
		openDeepLink() {
			if ( ! this.config.focus || ! this.config.discussions ) {
				return;
			}
			this.setTab( 'discussion' );
			const thread = this.threads.find( ( t ) => t.id === this.config.thread );
			if ( thread ) {
				this.flash( thread.id, 8000 );
				this.filter = thread.status;
				this.renderCounts();
				this.renderThreads();
				if ( thread.block && this.editor ) {
					this.editor.reveal( thread.block, true );
				}
			}
			this.scrollToHighlight();
		}

		/**
		 * Highlights a thread for a moment.
		 *
		 * @param {number} id       Thread ID.
		 * @param {number} duration Milliseconds.
		 */
		flash( id, duration ) {
			this.highlight = id;
			clearTimeout( this.flashTimer );
			this.flashTimer = setTimeout( () => {
				this.highlight = 0;
				this.root.querySelectorAll( '.nfd-thread.is-highlighted' ).forEach( ( li ) => li.classList.remove( 'is-highlighted' ) );
			}, duration );
		}

		scrollToHighlight() {
			const el = this.root.isConnected && this.root.querySelector( '.nfd-thread.is-highlighted' );
			if ( el ) {
				el.scrollIntoView( { block: 'center' } );
			}
		}

		/**
		 * Called when the block editor shows the panel.
		 *
		 * @param {string|null} clientId Block to start a comment on, if any.
		 */
		mounted( clientId ) {
			if ( clientId ) {
				this.commentOn( clientId );
			} else {
				this.updateAnchorHint();
				this.scrollToHighlight();
			}
		}

		status( text, isError ) {
			const el = this.$( '.nfd-status' );
			if ( el ) {
				el.textContent = text || '';
				el.classList.toggle( 'is-error', !! isError );
				clearTimeout( this.statusTimer );
				if ( text && ! isError ) {
					this.statusTimer = setTimeout( () => ( el.textContent = '' ), 2500 );
				}
			}
		}

		/* Actions ------------------------------------------------------------------------------ */

		async submit() {
			const textarea = this.$( '.nfd-compose textarea' );
			const text = textarea.value.trim();
			if ( ! text ) {
				textarea.focus();
				return;
			}
			const body = {
				type: this.kind,
				text,
				mentions: Array.from( this.mentions ).filter( ( id ) => text.includes( '@' + this.person( id ).name ) ),
				assignee: this.kind === 'issue' ? Number( this.$( '.nfd-assign select' ).value ) : 0,
			};
			const block = this.editor && this.anchor;
			if ( block ) {
				body.block = this.editor.anchor( block.clientId );
				body.quote = block.text || block.label;
			}
			const button = this.$( '.nfd-submit' );
			button.disabled = true;
			try {
				const res = await api( '/posts/' + this.config.post + '/threads', { method: 'POST', data: body } );
				textarea.value = '';
				this.mentions.clear();
				this.anchor = null;
				this.filter = 'open';
				this.$( '.nfd-assign select' ).value = '0';
				this.setKind( 'comment' );
				this.flash( res.created, 3000 );
				this.apply( res );
				this.updateAnchorHint();
				this.status( block && this.editor.isDirty() ? __( 'Posted. Save the post to keep it attached to the block.', 'noteflow' ) : __( 'Posted.', 'noteflow' ) );
				const el = this.root.querySelector( '[data-thread="' + res.created + '"]' );
				if ( el ) {
					el.scrollIntoView( { block: 'nearest' } );
				}
			} catch ( err ) {
				this.status( err && err.message, true );
			} finally {
				button.disabled = false;
			}
		}

		async reply( id ) {
			const textarea = this.root.querySelector( 'textarea[data-thread="' + id + '"]' );
			const text = textarea ? textarea.value.trim() : '';
			if ( ! text ) {
				if ( textarea ) {
					textarea.focus();
				}
				return;
			}
			try {
				const res = await api( '/posts/' + this.config.post + '/threads/' + id + '/replies', {
					method: 'POST',
					data: { text, mentions: Array.from( this.mentions ).filter( ( uid ) => text.includes( '@' + this.person( uid ).name ) ) },
				} );
				delete this.drafts[ id ];
				textarea.value = '';
				this.mentions.clear();
				this.apply( res );
			} catch ( err ) {
				this.status( err && err.message, true );
			}
		}

		async update( id, data ) {
			try {
				this.apply( await api( '/posts/' + this.config.post + '/threads/' + id, { method: 'POST', data } ) );
			} catch ( err ) {
				this.status( err && err.message, true );
			}
		}

		async remove( path ) {
			// eslint-disable-next-line no-alert
			if ( ! window.confirm( __( 'Delete this for everyone?', 'noteflow' ) ) ) {
				return;
			}
			try {
				this.apply( await api( '/posts/' + this.config.post + path, { method: 'DELETE' } ) );
			} catch ( err ) {
				this.status( err && err.message, true );
			}
		}

		async addNote() {
			const textarea = this.$( '.nfd-note-form textarea' );
			const text = textarea.value.trim();
			if ( ! text ) {
				textarea.focus();
				return;
			}
			try {
				const content = text
					.split( /\n{2,}/ )
					.map( ( p ) => '<p>' + esc( p ).replace( /\n/g, '<br>' ) + '</p>' )
					.join( '' );
				await api( '/notes', { method: 'POST', data: { content, linked: this.config.post } } );
				textarea.value = '';
				const res = await api( '/posts/' + this.config.post + '/notes' );
				this.notes = res.notes;
				this.renderNotes();
				this.renderCounts();
			} catch ( err ) {
				this.status( err && err.message, true );
			}
		}

		/**
		 * From the block toolbar: shows the block's open threads and starts a new comment on it.
		 *
		 * @param {string} clientId Block.
		 */
		commentOn( clientId ) {
			if ( ! this.editor || ! this.config.discussions ) {
				return;
			}
			this.setTab( 'discussion' );
			this.anchor = this.editor.describe( clientId );
			const id = this.editor.anchorOf( clientId );
			if ( id && this.filter !== 'open' && this.threads.some( ( t ) => t.block === id && t.status === 'open' ) ) {
				this.filter = 'open';
				this.renderCounts();
				this.renderThreads();
			}
			this.updateAnchorHint();
			this.markCurrent( clientId, true );
			this.$( '.nfd-compose textarea' ).focus( { preventScroll: !! id } );
		}

		/* @mentions ---------------------------------------------------------------------------- */

		updateMentions( textarea ) {
			const list = textarea.parentNode.querySelector( '.nfd-mentions' ) || this.$( '.nfd-mentions' );
			const before = textarea.value.slice( 0, textarea.selectionStart );
			const match = before.match( /(^|\s)@([^\s@]{0,30})$/ );
			this.mentionTarget = textarea;
			if ( ! match ) {
				this.mentionMatches = [];
			} else {
				const q = match[ 2 ].toLowerCase();
				this.mentionMatches = this.candidates.filter( ( p ) => p.name.toLowerCase().includes( q ) ).slice( 0, 6 );
			}
			this.mentionActive = 0;
			this.mentionList = list;
			this.renderMentions();
		}

		renderMentions() {
			const list = this.mentionList;
			if ( ! list ) {
				return;
			}
			const matches = this.mentionMatches || [];
			list.hidden = ! matches.length;
			list.innerHTML = matches
				.map( ( p, i ) => '<li role="option" aria-selected="' + ( i === this.mentionActive ) + '"><button type="button" data-mention="' + p.id + '" class="' + ( i === this.mentionActive ? 'is-active' : '' ) + '">' + avatar( p, 20 ) + esc( p.name ) + '</button></li>' )
				.join( '' );
		}

		pickMention( id ) {
			const textarea = this.mentionTarget;
			const p = this.person( id );
			const pos = textarea.selectionStart;
			const before = textarea.value.slice( 0, pos ).replace( /@([^\s@]{0,30})$/, '@' + p.name + ' ' );
			textarea.value = before + textarea.value.slice( pos );
			textarea.setSelectionRange( before.length, before.length );
			this.mentions.add( id );
			this.mentionMatches = [];
			this.renderMentions();
			textarea.focus();
		}

		/* Events --------------------------------------------------------------------------- */

		bind() {
			const root = this.root;

			root.addEventListener( 'click', ( e ) => {
				const t = e.target.closest( 'button' );
				if ( ! t || ! root.contains( t ) ) {
					return;
				}
				const d = t.dataset;
				if ( d.tab ) {
					this.setTab( d.tab );
				} else if ( d.kind ) {
					this.setKind( d.kind );
				} else if ( d.filter ) {
					this.filter = d.filter;
					this.renderCounts();
					this.renderThreads();
				} else if ( d.resolve ) {
					this.update( Number( d.resolve ), { status: 'resolved' } );
				} else if ( d.reopen ) {
					this.update( Number( d.reopen ), { status: 'open' } );
				} else if ( d.reply ) {
					this.reply( Number( d.reply ) );
				} else if ( d.deleteThread ) {
					this.remove( '/threads/' + d.deleteThread );
				} else if ( d.deleteReply ) {
					this.remove( '/replies/' + d.deleteReply );
				} else if ( d.mention ) {
					this.pickMention( Number( d.mention ) );
				} else if ( t.classList.contains( 'nfd-submit' ) ) {
					this.submit();
				} else if ( t.classList.contains( 'nfd-note-add' ) ) {
					this.addNote();
				} else if ( t.classList.contains( 'nfd-quote' ) && d.block && this.editor ) {
					if ( ! this.editor.reveal( d.block ) ) {
						this.status( __( 'That block is not in the post any more, or the post has not been saved since.', 'noteflow' ), true );
					}
				}
			} );

			root.addEventListener( 'input', ( e ) => {
				if ( e.target.tagName === 'TEXTAREA' && ! e.target.closest( '.nfd-note-form' ) ) {
					this.updateMentions( e.target );
					if ( e.target.dataset.thread ) {
						e.target.style.height = 'auto';
						e.target.style.height = Math.min( 160, e.target.scrollHeight ) + 'px';
					}
				}
			} );

			root.addEventListener( 'keydown', ( e ) => {
				if ( e.target.tagName !== 'TEXTAREA' ) {
					return;
				}
				const matches = this.mentionMatches || [];
				if ( matches.length && this.mentionTarget === e.target ) {
					if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
						e.preventDefault();
						this.mentionActive = ( this.mentionActive + ( e.key === 'ArrowDown' ? 1 : -1 ) + matches.length ) % matches.length;
						this.renderMentions();
						return;
					}
					if ( e.key === 'Enter' || e.key === 'Tab' ) {
						e.preventDefault();
						this.pickMention( matches[ this.mentionActive ].id );
						return;
					}
					if ( e.key === 'Escape' ) {
						e.preventDefault();
						this.mentionMatches = [];
						this.renderMentions();
						return;
					}
				}
				if ( e.key === 'Enter' && ( e.metaKey || e.ctrlKey ) ) {
					e.preventDefault();
					if ( e.target.dataset.thread ) {
						this.reply( Number( e.target.dataset.thread ) );
					} else if ( e.target.closest( '.nfd-compose' ) ) {
						this.submit();
					} else if ( e.target.closest( '.nfd-note-form' ) ) {
						this.addNote();
					}
				}
			} );
		}
	}

	window.NoteFlowDiscussion = Discussion;

	// The classic editor: mount into the NoteFlow box.
	document.addEventListener( 'DOMContentLoaded', () => {
		const box = document.getElementById( 'noteflow-discussion-root' );
		if ( box && window.noteflowDiscussion ) {
			box.nfd = new Discussion( box, window.noteflowDiscussion, null );
			const postbox = box.closest( '.postbox' );
			if ( window.noteflowDiscussion.focus && postbox ) {
				postbox.classList.remove( 'closed' );
				postbox.scrollIntoView( { block: 'start' } );
			}
		}
	} );
}() );
