/**
 * NoteFlow quick notes: the toolbar's Note button, the Dashboard widget and the
 * Notes box on editing screens.
 */
( function () {
	'use strict';

	const data = window.noteflowQuick || {};
	const { __, sprintf } = wp.i18n;
	const isMac = /Mac|iPhone|iPad/.test( navigator.platform || navigator.userAgent );

	const esc = ( value ) =>
		String( value === null || value === undefined ? '' : value ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );

	/** Plain text as note HTML: paragraphs, line breaks, and "[] " lines as a checklist. */
	function toHTML( text ) {
		const out = [];
		let list = [];
		const flush = () => {
			if ( list.length ) {
				out.push( '<ul class="nf-checklist">' + list.join( '' ) + '</ul>' );
				list = [];
			}
		};
		text.replace( /\r\n?/g, '\n' )
			.split( '\n' )
			.forEach( ( line ) => {
				const item = line.match( /^\s*(?:[-*]\s*)?\[( |x|X)?\]\s+(.*)$/ );
				if ( item ) {
					list.push( '<li' + ( item[ 1 ] && item[ 1 ].trim() ? ' class="nf-checked"' : '' ) + '>' + esc( item[ 2 ] ) + '</li>' );
					return;
				}
				flush();
				out.push( line.trim() ? '<p>' + esc( line ) + '</p>' : '<p><br></p>' );
			} );
		flush();
		return out.join( '' ).replace( /(<p><br><\/p>)+$/, '' );
	}

	function noteUrl( id ) {
		const url = new URL( data.app, window.location.href );
		url.searchParams.set( 'note', id );
		return url.toString();
	}

	function save( body ) {
		return wp.apiFetch( { path: '/noteflow/v1/notes', method: 'POST', data: body } );
	}

	/** A list item like the ones PHP renders. */
	function item( note ) {
		const li = document.createElement( 'li' );
		li.innerHTML =
			'<a href="' + esc( noteUrl( note.id ) ) + '"><span class="nf-cn-title">' + esc( note.title || __( 'New Note', 'noteflow' ) ) + '</span>' +
			( note.excerpt ? '<span class="nf-cn-excerpt">' + esc( note.excerpt ) + '</span>' : '' ) +
			'<span class="nf-cn-meta">' + esc( __( 'Just now', 'noteflow' ) ) + '</span></a>';
		li.classList.add( 'is-new' );
		return li;
	}

	function status( el, text, isError ) {
		if ( el ) {
			el.textContent = text;
			el.classList.toggle( 'is-error', !! isError );
		}
	}

	/* Toolbar quick capture ------------------------------------------------------------ */

	let pop = null;

	function closeCapture() {
		if ( pop ) {
			pop.remove();
			pop = null;
			const link = document.querySelector( '#wp-admin-bar-noteflow-quick > a' );
			if ( link ) {
				link.setAttribute( 'aria-expanded', 'false' );
				link.focus();
			}
		}
	}

	function openCapture() {
		if ( pop ) {
			closeCapture();
			return;
		}
		const link = document.querySelector( '#wp-admin-bar-noteflow-quick > a' );
		pop = document.createElement( 'div' );
		pop.className = 'nf-q-pop';
		pop.setAttribute( 'role', 'dialog' );
		pop.setAttribute( 'aria-label', __( 'Quick note', 'noteflow' ) );

		const folders = data.folders || [];
		const hint = isMac ? '⌘↩' : 'Ctrl+Enter';
		pop.innerHTML =
			'<form class="nf-q-form">' +
			'<div class="nf-q-head"><strong>' + esc( __( 'Quick note', 'noteflow' ) ) + '</strong><button type="button" class="nf-q-close" aria-label="' + esc( __( 'Close', 'noteflow' ) ) + '">&times;</button></div>' +
			'<input type="text" class="nf-q-title" placeholder="' + esc( __( 'Title', 'noteflow' ) ) + '" aria-label="' + esc( __( 'Title', 'noteflow' ) ) + '" maxlength="200">' +
			'<textarea class="nf-q-text" rows="5" placeholder="' + esc( __( 'Write it down. Start a line with [] for a checklist item.', 'noteflow' ) ) + '" aria-label="' + esc( __( 'Note', 'noteflow' ) ) + '"></textarea>' +
			( folders.length
				? '<label class="nf-q-row"><span>' + esc( __( 'Folder', 'noteflow' ) ) + '</span><select class="nf-q-folder"><option value="">' + esc( __( 'Notes', 'noteflow' ) ) + '</option>' +
				  folders.map( ( f ) => '<option value="' + esc( f.id ) + '">' + esc( f.name ) + '</option>' ).join( '' ) + '</select></label>'
				: '' ) +
			( data.link
				? /* translators: %s: post title. */
				  '<label class="nf-q-check"><input type="checkbox" class="nf-q-link" checked> ' + esc( sprintf( __( 'Attach to “%s”', 'noteflow' ), data.link.title ) ) + '</label>'
				: '' ) +
			'<div class="nf-q-actions"><a class="nf-q-open" href="' + esc( data.app ) + '">' + esc( __( 'Open NoteFlow', 'noteflow' ) ) + '</a>' +
			'<span class="nf-q-status" role="status"></span>' +
			'<button type="submit" class="nf-q-save">' + esc( __( 'Save', 'noteflow' ) ) + ' <kbd>' + esc( hint ) + '</kbd></button></div>' +
			'</form>';

		document.body.appendChild( pop );
		if ( link ) {
			link.setAttribute( 'aria-expanded', 'true' );
			const rect = link.getBoundingClientRect();
			const left = Math.min( Math.max( 8, rect.left ), window.innerWidth - pop.offsetWidth - 8 );
			pop.style.left = left + 'px';
			pop.style.top = rect.bottom + 6 + 'px';
		}

		const form = pop.querySelector( 'form' );
		const text = pop.querySelector( '.nf-q-text' );
		const title = pop.querySelector( '.nf-q-title' );
		const state = pop.querySelector( '.nf-q-status' );
		title.focus();

		pop.querySelector( '.nf-q-close' ).addEventListener( 'click', closeCapture );
		pop.addEventListener( 'keydown', ( e ) => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				closeCapture();
			} else if ( e.key === 'Enter' && ( e.metaKey || e.ctrlKey ) ) {
				e.preventDefault();
				form.requestSubmit();
			}
		} );
		form.addEventListener( 'submit', async ( e ) => {
			e.preventDefault();
			if ( ! title.value.trim() && ! text.value.trim() ) {
				text.focus();
				return;
			}
			const folder = pop.querySelector( '.nf-q-folder' );
			const attach = pop.querySelector( '.nf-q-link' );
			const button = pop.querySelector( '.nf-q-save' );
			button.disabled = true;
			status( state, __( 'Saving…', 'noteflow' ) );
			try {
				const res = await save( {
					title: title.value.trim(),
					content: toHTML( text.value ),
					folder: folder ? folder.value : '',
					linked: attach && attach.checked && data.link ? data.link.id : 0,
				} );
				state.innerHTML = esc( __( 'Saved.', 'noteflow' ) ) + ' <a href="' + esc( noteUrl( res.note.id ) ) + '">' + esc( __( 'Open', 'noteflow' ) ) + '</a>';
				title.value = '';
				text.value = '';
				setTimeout( () => pop && pop.contains( state ) && closeCapture(), 2500 );
			} catch ( err ) {
				status( state, ( err && err.message ) || __( 'Could not save the note.', 'noteflow' ), true );
			} finally {
				button.disabled = false;
			}
		} );
	}

	if ( data.capture ) {
		document.addEventListener( 'click', ( e ) => {
			const link = e.target.closest( '#wp-admin-bar-noteflow-quick > a' );
			if ( link ) {
				e.preventDefault();
				openCapture();
			} else if ( pop && ! pop.contains( e.target ) ) {
				closeCapture();
			}
		} );
		document.addEventListener( 'keydown', ( e ) => {
			if ( e.altKey && e.shiftKey && ( e.code === 'KeyN' || e.key === 'N' ) && ! e.metaKey && ! e.ctrlKey ) {
				e.preventDefault();
				openCapture();
			}
		} );
	}

	/* Dashboard widget and the editor's Notes box -------------------------------------- */

	function bindBox( box, options ) {
		const text = box.querySelector( 'textarea' );
		const button = box.querySelector( options.button );
		const state = box.querySelector( options.status );
		if ( ! text || ! button ) {
			return;
		}

		const submit = async () => {
			if ( ! text.value.trim() ) {
				text.focus();
				return;
			}
			button.disabled = true;
			status( state, __( 'Saving…', 'noteflow' ) );
			try {
				const res = await save( Object.assign( { content: toHTML( text.value ) }, options.extra() ) );
				let list = box.querySelector( options.list );
				if ( ! list ) {
					list = document.createElement( 'ul' );
					list.className = 'nf-cn-list';
					text.closest( options.form ).after( list );
				}
				list.prepend( item( res.note ) );
				text.value = '';
				const empty = box.querySelector( '.nf-cn-empty, .nf-dash-empty' );
				if ( empty ) {
					empty.hidden = true;
				}
				status( state, __( 'Saved.', 'noteflow' ) );
				setTimeout( () => status( state, '' ), 2500 );
			} catch ( err ) {
				status( state, ( err && err.message ) || __( 'Could not save the note.', 'noteflow' ), true );
			} finally {
				button.disabled = false;
			}
		};

		button.addEventListener( 'click', submit );
		text.addEventListener( 'keydown', ( e ) => {
			if ( e.key === 'Enter' && ( e.metaKey || e.ctrlKey ) ) {
				e.preventDefault();
				submit();
			}
		} );
	}

	document.querySelectorAll( '.nf-dash' ).forEach( ( box ) =>
		bindBox( box, {
			button: '.nf-dash-save',
			status: '.nf-dash-status',
			list: '.nf-dash-recent',
			form: '.nf-dash-quick',
			extra: () => ( {} ),
		} )
	);

	document.querySelectorAll( '.nf-cn' ).forEach( ( box ) =>
		bindBox( box, {
			button: '.nf-cn-save',
			status: '.nf-cn-status',
			list: '.nf-cn-list',
			form: '.nf-cn-form',
			extra: () => ( { linked: Number( box.dataset.post ) } ),
		} )
	);
}() );
