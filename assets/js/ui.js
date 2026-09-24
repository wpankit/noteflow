/**
 * NoteFlow UI kit: icons, menus, dialogs, toasts, dates and Markdown export.
 *
 * Exposes window.NoteFlowUI.
 */
( function () {
	'use strict';

	const { __, sprintf } = wp.i18n;

	/* Icons: 24px line icons, drawn for NoteFlow. -------------------------------------- */

	const ICONS = {
		compose: '<path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6"/><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 8 16l1.2-4Z"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
		folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2.1 2.2h7.3A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>',
		folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2.1 2.2h7.3A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/><path d="M12 10.5v6M9 13.5h6"/>',
		notes: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
		shared: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H6.5a4 4 0 0 0-4 4V20"/><circle cx="9.2" cy="7.5" r="3.5"/><path d="M21.5 20v-1.5a4 4 0 0 0-3-3.9M16 4.1a3.6 3.6 0 0 1 0 6.9"/>',
		userPlus: '<path d="M15 20v-1.5a4 4 0 0 0-4-4H6.5a4 4 0 0 0-4 4V20"/><circle cx="8.7" cy="7.5" r="3.5"/><path d="M19 8v6M16 11h6"/>',
		trash: '<path d="M3.5 6h17M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M18.5 6l-.8 13a2 2 0 0 1-2 2H8.3a2 2 0 0 1-2-2L5.5 6M10 10.5v6M14 10.5v6"/>',
		bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/>',
		clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
		hash: '<path d="M4.5 9h16M3.5 15h16M10.5 3 8.5 21M15.5 3l-2 18"/>',
		checklist: '<path d="M11 6.5h9.5M11 12h9.5M11 17.5h9.5"/><path d="m3.5 6.5 1.6 1.6L8 5.2M3.5 12l1.6 1.6L8 10.7M3.5 17.5l1.6 1.6L8 16.2"/>',
		table: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M3 14.8h18M9 9.5V20M15 9.5V20"/>',
		image: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><circle cx="8.5" cy="9" r="1.7"/><path d="m21 15.5-4.8-4.8L5.5 20.5"/>',
		link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.8.5l2.9-2.9a4.6 4.6 0 0 0-6.5-6.5l-1.6 1.6"/><path d="M14 10.5a4.5 4.5 0 0 0-6.8-.5l-2.9 2.9a4.6 4.6 0 0 0 6.5 6.5l1.6-1.6"/>',
		more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
		pin: '<path d="M12 16.5V22M8.8 3h6.4l-1 5.5 3.8 3.8v2.2H6v-2.2l3.8-3.8Z"/>',
		comment: '<path d="M20.5 11.6a8.1 8.1 0 0 1-11.7 7.3L3.5 20.5l1.7-4.8a8.1 8.1 0 1 1 15.3-4.1Z"/>',
		history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.4"/><path d="M3.5 3.8v4.6h4.6M12 7.5V12l3 2"/>',
		listView: '<path d="M9 6h11.5M9 12h11.5M9 18h11.5"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
		gallery: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
		chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
		chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
		chevronLeft: '<path d="m14.5 18-6-6 6-6"/>',
		sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/>',
		close: '<path d="M18 6 6 18M6 6l12 12"/>',
		check: '<path d="M20 6.5 9.2 17.3 4 12"/>',
		sliders: '<path d="M4 21v-6.5M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14.5h5M9.5 8h5M17.5 16h5"/>',
		file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
		copy: '<rect x="9" y="9" width="12" height="12" rx="2.2"/><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"/>',
		download: '<path d="M12 3.5v11.5M7 10.5l5 5 5-5M4.5 20.5h15"/>',
		upload: '<path d="M12 20.5V9M7 13.5l5-5 5 5M4.5 3.5h15"/>',
		printer: '<path d="M6.5 9V3.5h11V9"/><rect x="3" y="9" width="18" height="8" rx="2.2"/><path d="M6.5 14h11v6.5h-11z"/>',
		restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.4"/><path d="M3.5 3.8v4.6h4.6"/>',
		globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13.8 13.8 0 0 1 0 18M12 3a13.8 13.8 0 0 0 0 18"/>',
		lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
		eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
		keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
		leave: '<path d="M9.5 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4M16 16.5l4.5-4.5L16 7.5M20.5 12H9"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		external: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
		palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A4.5 4.5 0 0 0 21 10.8C21 6.5 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10.5" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7.5" r="1" fill="currentColor"/>',
		template: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9h17M9 9v11.5"/>',
		star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>',
		arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
		alert: '<path d="M12 3.5 2.5 20h19Z"/><path d="M12 10v4.5M12 17.2h.01"/>',
		sort: '<path d="M4 7h16M7 12h10M10 17h4"/>',
		sync: '<path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9M3.5 12a8.5 8.5 0 0 1 14.6-5.9"/><path d="M18.5 3v3.5H15M5.5 21v-3.5H9"/>',
	};

	function icon( name, size ) {
		const px = size || 18;
		return '<svg class="nf-icon nf-icon-' + name + '" viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ( ICONS[ name ] || '' ) + '</svg>';
	}

	const esc = ( value ) =>
		String( value === null || value === undefined ? '' : value ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );

	/* Layer: everything that floats sits in one container inside the app. ---------------- */

	let layer = null;
	let lastFocus = null;

	function setLayer( el ) {
		layer = el;
	}

	/* Menus ---------------------------------------------------------------------------- */

	let openMenuEl = null;

	function closeMenu( restore ) {
		if ( openMenuEl ) {
			const { el, anchor, onClose } = openMenuEl;
			openMenuEl = null;
			el.remove();
			if ( anchor ) {
				anchor.setAttribute( 'aria-expanded', 'false' );
			}
			if ( onClose ) {
				onClose();
			}
			if ( restore !== false && anchor && document.contains( anchor ) ) {
				anchor.focus( { preventScroll: true } );
			}
		}
	}

	/**
	 * Opens a menu.
	 *
	 * @param {HTMLElement|{x:number,y:number}} anchor Button, or a point for context menus.
	 * @param {Array}  items   { label, icon, action, checked, danger, disabled, hint, submenu } or '-'.
	 * @param {Object} options { align: 'start'|'end', onClose, className }.
	 */
	function menu( anchor, items, options ) {
		closeMenu( false );
		options = options || {};

		const el = document.createElement( 'div' );
		el.className = 'nf-menu ' + ( options.className || '' );
		el.setAttribute( 'role', 'menu' );

		const buttons = [];
		items.forEach( ( item ) => {
			if ( ! item ) {
				return;
			}
			if ( item === '-' ) {
				const sep = document.createElement( 'div' );
				sep.className = 'nf-menu-sep';
				sep.setAttribute( 'role', 'separator' );
				el.appendChild( sep );
				return;
			}
			if ( item.heading ) {
				const head = document.createElement( 'div' );
				head.className = 'nf-menu-heading';
				head.textContent = item.heading;
				el.appendChild( head );
				return;
			}
			if ( item.html ) {
				const box = document.createElement( 'div' );
				box.className = 'nf-menu-custom';
				box.innerHTML = item.html;
				if ( item.bind ) {
					item.bind( box, () => closeMenu() );
				}
				el.appendChild( box );
				return;
			}
			const btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.className = 'nf-menu-item' + ( item.danger ? ' is-danger' : '' ) + ( item.checked ? ' is-checked' : '' );
			btn.setAttribute( 'role', item.checked !== undefined ? 'menuitemradio' : 'menuitem' );
			if ( item.checked !== undefined ) {
				btn.setAttribute( 'aria-checked', item.checked ? 'true' : 'false' );
			}
			btn.disabled = !! item.disabled;
			btn.innerHTML =
				'<span class="nf-menu-check">' + ( item.checked ? icon( 'check', 14 ) : '' ) + '</span>' +
				( item.icon ? icon( item.icon, 16 ) : '' ) +
				'<span class="nf-menu-label">' + esc( item.label ) + '</span>' +
				( item.hint ? '<kbd class="nf-menu-hint">' + esc( item.hint ) + '</kbd>' : '' ) +
				( item.submenu ? icon( 'chevronRight', 14 ) : '' );
			btn.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				if ( item.submenu ) {
					const rect = btn.getBoundingClientRect();
					const anchorPoint = { x: rect.right - 4, y: rect.top - 6, returnTo: anchor };
					menu( anchorPoint, item.submenu, options );
					return;
				}
				closeMenu();
				if ( item.action ) {
					item.action();
				}
			} );
			buttons.push( btn );
			el.appendChild( btn );
		} );

		( layer || document.body ).appendChild( el );
		position( el, anchor, options.align );

		if ( anchor && anchor.setAttribute ) {
			anchor.setAttribute( 'aria-expanded', 'true' );
		}
		openMenuEl = { el, anchor: anchor && anchor.focus ? anchor : anchor && anchor.returnTo, onClose: options.onClose };

		el.addEventListener( 'keydown', ( e ) => {
			const enabled = buttons.filter( ( b ) => ! b.disabled );
			const index = enabled.indexOf( document.activeElement );
			if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
				e.preventDefault();
				const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
				enabled[ ( next + enabled.length ) % enabled.length ]?.focus();
			} else if ( e.key === 'Escape' ) {
				e.preventDefault();
				e.stopPropagation();
				closeMenu();
			} else if ( e.key === 'Tab' ) {
				closeMenu();
			} else if ( e.key === 'Home' || e.key === 'End' ) {
				e.preventDefault();
				enabled[ e.key === 'Home' ? 0 : enabled.length - 1 ]?.focus();
			}
		} );

		const first = buttons.find( ( b ) => ! b.disabled );
		if ( first && ! options.noFocus ) {
			first.focus( { preventScroll: true } );
		}
		return el;
	}

	/** Places a floating element next to an anchor or point, inside the viewport. */
	function position( el, anchor, align ) {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const box = el.getBoundingClientRect();
		let x;
		let y;

		if ( anchor && anchor.getBoundingClientRect ) {
			const r = anchor.getBoundingClientRect();
			x = align === 'end' ? r.right - box.width : r.left;
			y = r.bottom + 6;
			if ( y + box.height > vh - 8 ) {
				y = Math.max( 8, r.top - box.height - 6 );
			}
		} else if ( anchor ) {
			x = anchor.x;
			y = anchor.y;
			if ( x + box.width > vw - 8 ) {
				x = Math.max( 8, anchor.x - box.width );
			}
			if ( y + box.height > vh - 8 ) {
				y = Math.max( 8, vh - box.height - 8 );
			}
		} else {
			x = ( vw - box.width ) / 2;
			y = ( vh - box.height ) / 3;
		}

		x = Math.min( Math.max( 8, x ), vw - box.width - 8 );
		el.style.left = Math.round( x ) + 'px';
		el.style.top = Math.round( y ) + 'px';
	}

	document.addEventListener( 'mousedown', ( e ) => {
		if ( openMenuEl && ! openMenuEl.el.contains( e.target ) && ! ( openMenuEl.anchor && openMenuEl.anchor.contains && openMenuEl.anchor.contains( e.target ) ) ) {
			closeMenu( false );
		}
	} );
	window.addEventListener( 'resize', () => closeMenu( false ) );

	/* Popovers: small panels anchored to a button (link editor, pickers). --------------- */

	let openPopoverEl = null;

	function closePopover() {
		if ( openPopoverEl ) {
			const { el, anchor, onClose } = openPopoverEl;
			openPopoverEl = null;
			el.remove();
			if ( onClose ) {
				onClose();
			}
			if ( anchor && anchor.focus && document.contains( anchor ) ) {
				anchor.focus( { preventScroll: true } );
			}
		}
	}

	function popover( anchor, html, options ) {
		closePopover();
		closeMenu( false );
		options = options || {};
		const el = document.createElement( 'div' );
		el.className = 'nf-popover ' + ( options.className || '' );
		el.setAttribute( 'role', 'dialog' );
		if ( options.label ) {
			el.setAttribute( 'aria-label', options.label );
		}
		el.innerHTML = html;
		( layer || document.body ).appendChild( el );
		position( el, anchor, options.align );
		openPopoverEl = { el, anchor, onClose: options.onClose };

		el.addEventListener( 'keydown', ( e ) => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				e.stopPropagation();
				closePopover();
			}
		} );
		setTimeout( () => {
			const focusable = el.querySelector( 'input,textarea,select,button' );
			if ( focusable ) {
				focusable.focus();
			}
		} );
		return el;
	}

	document.addEventListener( 'mousedown', ( e ) => {
		if ( openPopoverEl && ! openPopoverEl.el.contains( e.target ) && ! ( openPopoverEl.anchor && openPopoverEl.anchor.contains && openPopoverEl.anchor.contains( e.target ) ) && ! e.target.closest( '.nf-menu' ) ) {
			closePopover();
		}
	} );

	/* Dialogs ---------------------------------------------------------------------------- */

	const dialogs = [];

	/**
	 * Opens a modal dialog.
	 *
	 * @param {Object} options { title, body (HTML), className, actions: [{ label, primary, danger, action(close) }], onOpen(el, close), onClose, wide }.
	 * @return {Function} close
	 */
	function dialog( options ) {
		closeMenu( false );
		closePopover();
		lastFocus = document.activeElement;

		const backdrop = document.createElement( 'div' );
		backdrop.className = 'nf-backdrop';
		const id = 'nf-dialog-' + Math.random().toString( 36 ).slice( 2 );
		backdrop.innerHTML =
			'<div class="nf-dialog ' + ( options.className || '' ) + ( options.wide ? ' is-wide' : '' ) + '" role="dialog" aria-modal="true" aria-labelledby="' + id + '">' +
			'<div class="nf-dialog-head"><h2 id="' + id + '">' + esc( options.title ) + '</h2>' +
			'<button type="button" class="nf-icon-button nf-dialog-close" aria-label="' + esc( __( 'Close', 'noteflow' ) ) + '">' + icon( 'close', 16 ) + '</button></div>' +
			'<div class="nf-dialog-body">' + ( options.body || '' ) + '</div>' +
			( options.actions && options.actions.length ? '<div class="nf-dialog-actions"></div>' : '' ) +
			'</div>';

		const el = backdrop.firstElementChild;
		const focusBack = lastFocus;
		const close = () => {
			const index = dialogs.indexOf( close );
			if ( index === -1 ) {
				return;
			}
			dialogs.splice( index, 1 );
			backdrop.remove();
			if ( options.onClose ) {
				options.onClose();
			}
			if ( focusBack && document.contains( focusBack ) ) {
				focusBack.focus( { preventScroll: true } );
			}
		};
		dialogs.push( close );

		if ( options.actions ) {
			const bar = el.querySelector( '.nf-dialog-actions' );
			options.actions.forEach( ( action ) => {
				const btn = document.createElement( 'button' );
				btn.type = 'button';
				btn.className = 'nf-button' + ( action.primary ? ' is-primary' : '' ) + ( action.danger ? ' is-danger' : '' );
				btn.textContent = action.label;
				btn.addEventListener( 'click', () => ( action.action ? action.action( close, el ) : close() ) );
				bar.appendChild( btn );
			} );
		}

		el.querySelector( '.nf-dialog-close' ).addEventListener( 'click', close );
		backdrop.addEventListener( 'mousedown', ( e ) => {
			if ( e.target === backdrop ) {
				close();
			}
		} );
		el.addEventListener( 'keydown', ( e ) => {
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				e.stopPropagation();
				close();
			} else if ( e.key === 'Tab' ) {
				const focusable = Array.from( el.querySelectorAll( 'button,input,select,textarea,a[href],[tabindex="0"]' ) ).filter( ( n ) => ! n.disabled && n.offsetParent !== null );
				if ( ! focusable.length ) {
					return;
				}
				const first = focusable[ 0 ];
				const last = focusable[ focusable.length - 1 ];
				if ( e.shiftKey && document.activeElement === first ) {
					e.preventDefault();
					last.focus();
				} else if ( ! e.shiftKey && document.activeElement === last ) {
					e.preventDefault();
					first.focus();
				}
			}
		} );

		( layer || document.body ).appendChild( backdrop );
		if ( options.onOpen ) {
			options.onOpen( el, close );
		}
		setTimeout( () => {
			const target = el.querySelector( '[autofocus]' ) || el.querySelector( 'input,textarea,select' ) || el.querySelector( '.nf-dialog-actions .is-primary' ) || el.querySelector( '.nf-dialog-close' );
			if ( target ) {
				target.focus();
			}
		} );
		return close;
	}

	// Escape closes the topmost menu, popover or dialog, wherever focus is.
	document.addEventListener( 'keydown', ( e ) => {
		if ( e.key !== 'Escape' || e.defaultPrevented ) {
			return;
		}
		if ( openMenuEl ) {
			e.preventDefault();
			closeMenu();
		} else if ( openPopoverEl ) {
			e.preventDefault();
			closePopover();
		} else if ( dialogs.length ) {
			e.preventDefault();
			dialogs[ dialogs.length - 1 ]();
		}
	} );

	function confirmDialog( options ) {
		return new Promise( ( resolve ) => {
			let answered = false;
			dialog( {
				title: options.title,
				body: options.message ? '<p class="nf-dialog-text">' + esc( options.message ) + '</p>' : '',
				className: 'is-small',
				actions: [
					{ label: options.cancel || __( 'Cancel', 'noteflow' ), action: ( close ) => close() },
					{
						label: options.confirm || __( 'OK', 'noteflow' ),
						primary: ! options.danger,
						danger: !! options.danger,
						action: ( close ) => {
							answered = true;
							close();
							resolve( true );
						},
					},
				],
				onClose: () => ! answered && resolve( false ),
			} );
		} );
	}

	function askText( options ) {
		return new Promise( ( resolve ) => {
			let answered = false;
			const submit = ( close, el ) => {
				const value = el.querySelector( 'input' ).value.trim();
				if ( ! value ) {
					el.querySelector( 'input' ).focus();
					return;
				}
				answered = true;
				close();
				resolve( value );
			};
			dialog( {
				title: options.title,
				className: 'is-small',
				body: '<label class="nf-field"><span>' + esc( options.label ) + '</span><input type="text" maxlength="' + ( options.maxLength || 60 ) + '" value="' + esc( options.value || '' ) + '" autofocus></label>',
				actions: [
					{ label: __( 'Cancel', 'noteflow' ), action: ( close ) => close() },
					{ label: options.confirm || __( 'Save', 'noteflow' ), primary: true, action: submit },
				],
				onOpen: ( el, close ) => {
					const input = el.querySelector( 'input' );
					input.select();
					input.addEventListener( 'keydown', ( e ) => {
						if ( e.key === 'Enter' ) {
							e.preventDefault();
							submit( close, el );
						}
					} );
				},
				onClose: () => ! answered && resolve( null ),
			} );
		} );
	}

	/* Toasts ----------------------------------------------------------------------------- */

	let toastTimer = null;

	function toast( message, options ) {
		options = options || {};
		let region = ( layer || document.body ).querySelector( '.nf-toasts' );
		if ( ! region ) {
			region = document.createElement( 'div' );
			region.className = 'nf-toasts';
			region.setAttribute( 'role', 'status' );
			region.setAttribute( 'aria-live', 'polite' );
			( layer || document.body ).appendChild( region );
		}
		region.innerHTML = '';
		const el = document.createElement( 'div' );
		el.className = 'nf-toast' + ( options.error ? ' is-error' : '' );
		el.innerHTML = '<span>' + esc( message ) + '</span>';
		if ( options.action ) {
			const btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.textContent = options.action.label;
			btn.addEventListener( 'click', () => {
				el.remove();
				options.action.fn();
			} );
			el.appendChild( btn );
		}
		region.appendChild( el );
		clearTimeout( toastTimer );
		toastTimer = setTimeout( () => {
			el.classList.add( 'is-leaving' );
			setTimeout( () => el.remove(), 250 );
		}, options.timeout || ( options.action ? 6000 : 3200 ) );
	}

	/* Dates ------------------------------------------------------------------------------ */

	const locale = document.documentElement.lang || navigator.language || 'en-US';
	const fmt = ( opts ) => {
		try {
			return new Intl.DateTimeFormat( locale, opts );
		} catch ( e ) {
			return new Intl.DateTimeFormat( 'en-US', opts );
		}
	};
	const F = {
		time: fmt( { hour: 'numeric', minute: '2-digit' } ),
		weekday: fmt( { weekday: 'long' } ),
		short: fmt( { day: 'numeric', month: 'numeric', year: '2-digit' } ),
		long: fmt( { day: 'numeric', month: 'long', year: 'numeric' } ),
		month: fmt( { month: 'long' } ),
		monthYear: fmt( { month: 'long', year: 'numeric' } ),
		dayMonth: fmt( { day: 'numeric', month: 'short' } ),
		full: fmt( { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' } ),
		medium: fmt( { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } ),
	};

	const startOfDay = ( d ) => new Date( d.getFullYear(), d.getMonth(), d.getDate() ).getTime();
	const DAY = 86400000;

	/** How the notes list shows a date: a time today, then a weekday, then a date. */
	function listDate( ts ) {
		const d = new Date( ts * 1000 );
		const today = startOfDay( new Date() );
		const day = startOfDay( d );
		if ( day === today ) {
			return F.time.format( d );
		}
		if ( day === today - DAY ) {
			return __( 'Yesterday', 'noteflow' );
		}
		if ( today - day < 7 * DAY && day < today ) {
			return F.weekday.format( d );
		}
		return F.short.format( d );
	}

	/** Group key and label for date sections in the list. */
	function dateGroup( ts ) {
		const d = new Date( ts * 1000 );
		const now = new Date();
		const today = startOfDay( now );
		const day = startOfDay( d );
		if ( day >= today ) {
			return [ '0', __( 'Today', 'noteflow' ) ];
		}
		if ( day === today - DAY ) {
			return [ '1', __( 'Yesterday', 'noteflow' ) ];
		}
		if ( today - day < 7 * DAY ) {
			return [ '2', __( 'Previous 7 Days', 'noteflow' ) ];
		}
		if ( today - day < 30 * DAY ) {
			return [ '3', __( 'Previous 30 Days', 'noteflow' ) ];
		}
		if ( d.getFullYear() === now.getFullYear() ) {
			return [ '4-' + String( 12 - d.getMonth() ).padStart( 2, '0' ), F.month.format( d ) ];
		}
		return [ '5-' + ( 9999 - d.getFullYear() ), String( d.getFullYear() ) ];
	}

	function fullDate( ts ) {
		return F.full.format( new Date( ts * 1000 ) );
	}

	function mediumDate( ts ) {
		return F.medium.format( new Date( ts * 1000 ) );
	}

	/** "just now", "5 min ago", "3 hr ago", then a date. */
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
		return mediumDate( ts );
	}

	/** Reminder label: "Today, 5:00 PM", "Tomorrow, 9:00 AM" or a date. */
	function reminderLabel( ts ) {
		const d = new Date( ts * 1000 );
		const today = startOfDay( new Date() );
		const day = startOfDay( d );
		const time = F.time.format( d );
		if ( day === today ) {
			/* translators: %s: time. */
			return sprintf( __( 'Today, %s', 'noteflow' ), time );
		}
		if ( day === today + DAY ) {
			/* translators: %s: time. */
			return sprintf( __( 'Tomorrow, %s', 'noteflow' ), time );
		}
		return F.dayMonth.format( d ) + ', ' + time;
	}

	/* Markdown export --------------------------------------------------------------------- */

	function toMarkdown( html, title ) {
		const box = document.createElement( 'div' );
		box.innerHTML = html;

		const inline = ( node ) =>
			Array.from( node.childNodes )
				.map( ( child ) => {
					if ( child.nodeType === 3 ) {
						return child.nodeValue.replace( /([*_`[\]])/g, '\\$1' );
					}
					if ( child.nodeType !== 1 ) {
						return '';
					}
					const inner = inline( child );
					switch ( child.tagName ) {
						case 'STRONG':
						case 'B':
							return inner.trim() ? '**' + inner + '**' : inner;
						case 'EM':
						case 'I':
							return inner.trim() ? '_' + inner + '_' : inner;
						case 'S':
						case 'DEL':
							return '~~' + inner + '~~';
						case 'CODE':
							return '`' + child.textContent + '`';
						case 'MARK':
							return '==' + inner + '==';
						case 'A':
							return '[' + inner + '](' + child.getAttribute( 'href' ) + ')';
						case 'IMG':
							return '![' + ( child.getAttribute( 'alt' ) || '' ) + '](' + child.getAttribute( 'src' ) + ')';
						case 'BR':
							return '  \n';
						default:
							return inner;
					}
				} )
				.join( '' );

		const list = ( el, depth ) => {
			const lines = [];
			let n = 1;
			Array.from( el.children ).forEach( ( li ) => {
				const pad = '  '.repeat( depth );
				let marker = '- ';
				if ( el.tagName === 'OL' ) {
					marker = n++ + '. ';
				} else if ( el.classList.contains( 'nf-checklist' ) ) {
					marker = li.classList.contains( 'nf-checked' ) ? '- [x] ' : '- [ ] ';
				}
				const clone = li.cloneNode( true );
				clone.querySelectorAll( 'ul,ol' ).forEach( ( sub ) => sub.remove() );
				lines.push( pad + marker + inline( clone ).trim() );
				li.querySelectorAll( ':scope > ul, :scope > ol' ).forEach( ( sub ) => lines.push( list( sub, depth + 1 ) ) );
			} );
			return lines.join( '\n' );
		};

		const blocks = Array.from( box.children ).map( ( el ) => {
			switch ( el.tagName ) {
				case 'H1':
					return '# ' + inline( el ).trim();
				case 'H2':
					return '## ' + inline( el ).trim();
				case 'H3':
				case 'H4':
					return '### ' + inline( el ).trim();
				case 'UL':
				case 'OL':
					return list( el, 0 );
				case 'BLOCKQUOTE':
					return inline( el )
						.trim()
						.split( '\n' )
						.map( ( line ) => '> ' + line )
						.join( '\n' );
				case 'PRE':
					return '```\n' + el.textContent.replace( /\n$/, '' ) + '\n```';
				case 'HR':
					return '---';
				case 'TABLE': {
					const rows = Array.from( el.querySelectorAll( 'tr' ) ).map( ( tr ) => '| ' + Array.from( tr.children ).map( ( cell ) => inline( cell ).trim().replace( /\|/g, '\\|' ) ).join( ' | ' ) + ' |' );
					if ( rows.length ) {
						const cols = el.querySelector( 'tr' ).children.length;
						rows.splice( 1, 0, '|' + ' --- |'.repeat( cols ) );
					}
					return rows.join( '\n' );
				}
				default:
					return inline( el ).trim();
			}
		} );

		const body = blocks.filter( ( b ) => b !== '' ).join( '\n\n' );
		return ( title ? '# ' + title + '\n\n' : '' ) + body + '\n';
	}

	/** Minimal Markdown to HTML, for importing .md files. */
	function fromMarkdown( md ) {
		const escText = ( s ) => esc( s );
		const inline = ( s ) =>
			escText( s )
				.replace( /!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1">' )
				.replace( /\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>' )
				.replace( /`([^`]+)`/g, '<code>$1</code>' )
				.replace( /\*\*([^*]+)\*\*/g, '<strong>$1</strong>' )
				.replace( /(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>' )
				.replace( /(^|[^*])\*([^*]+)\*(?=[^*]|$)/g, '$1<em>$2</em>' )
				.replace( /~~([^~]+)~~/g, '<s>$1</s>' )
				.replace( /==([^=]+)==/g, '<mark>$1</mark>' );

		const lines = md.replace( /\r\n?/g, '\n' ).split( '\n' );
		const out = [];
		let list = null;
		let para = [];
		let code = null;

		const flushPara = () => {
			if ( para.length ) {
				out.push( '<p>' + para.map( inline ).join( '<br>' ) + '</p>' );
				para = [];
			}
		};
		const flushList = () => {
			if ( list ) {
				out.push( '<' + list.tag + ( list.cls ? ' class="' + list.cls + '"' : '' ) + '>' + list.items.join( '' ) + '</' + list.tag + '>' );
				list = null;
			}
		};

		lines.forEach( ( line ) => {
			if ( code !== null ) {
				if ( /^```/.test( line ) ) {
					out.push( '<pre>' + escText( code.join( '\n' ) ) + '</pre>' );
					code = null;
				} else {
					code.push( line );
				}
				return;
			}
			if ( /^```/.test( line ) ) {
				flushPara();
				flushList();
				code = [];
				return;
			}
			let m;
			if ( ( m = line.match( /^(#{1,6})\s+(.*)$/ ) ) ) {
				flushPara();
				flushList();
				const level = Math.min( 3, m[ 1 ].length );
				out.push( '<h' + level + '>' + inline( m[ 2 ] ) + '</h' + level + '>' );
			} else if ( ( m = line.match( /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/ ) ) ) {
				flushPara();
				if ( ! list || list.cls !== 'nf-checklist' ) {
					flushList();
					list = { tag: 'ul', cls: 'nf-checklist', items: [] };
				}
				list.items.push( '<li' + ( m[ 1 ] === ' ' ? '' : ' class="nf-checked"' ) + '>' + inline( m[ 2 ] ) + '</li>' );
			} else if ( ( m = line.match( /^\s*[-*+]\s+(.*)$/ ) ) ) {
				flushPara();
				if ( ! list || list.tag !== 'ul' || list.cls ) {
					flushList();
					list = { tag: 'ul', cls: '', items: [] };
				}
				list.items.push( '<li>' + inline( m[ 1 ] ) + '</li>' );
			} else if ( ( m = line.match( /^\s*\d+[.)]\s+(.*)$/ ) ) ) {
				flushPara();
				if ( ! list || list.tag !== 'ol' ) {
					flushList();
					list = { tag: 'ol', cls: '', items: [] };
				}
				list.items.push( '<li>' + inline( m[ 1 ] ) + '</li>' );
			} else if ( ( m = line.match( /^>\s?(.*)$/ ) ) ) {
				flushPara();
				flushList();
				out.push( '<blockquote><p>' + inline( m[ 1 ] ) + '</p></blockquote>' );
			} else if ( /^(-{3,}|\*{3,})$/.test( line.trim() ) ) {
				flushPara();
				flushList();
				out.push( '<hr>' );
			} else if ( ! line.trim() ) {
				flushPara();
				flushList();
			} else {
				flushList();
				para.push( line );
			}
		} );
		if ( code !== null ) {
			out.push( '<pre>' + escText( code.join( '\n' ) ) + '</pre>' );
		}
		flushPara();
		flushList();
		return out.join( '' );
	}

	/** Saves text as a file download. */
	function download( filename, text, type ) {
		const blob = new Blob( [ text ], { type: type || 'text/plain' } );
		const url = URL.createObjectURL( blob );
		const a = document.createElement( 'a' );
		a.href = url;
		a.download = filename;
		document.body.appendChild( a );
		a.click();
		a.remove();
		setTimeout( () => URL.revokeObjectURL( url ), 1000 );
	}

	function slug( text ) {
		return (
			String( text || 'note' )
				.toLowerCase()
				.normalize( 'NFKD' )
				.replace( /[̀-ͯ]/g, '' )
				.replace( /[^a-z0-9]+/g, '-' )
				.replace( /^-+|-+$/g, '' )
				.slice( 0, 60 ) || 'note'
		);
	}

	/* Avatars ------------------------------------------------------------------------------ */

	const AVATAR_COLORS = [ '#e07a5f', '#3d8bfd', '#8e6cf1', '#20a386', '#e0a100', '#d6538b', '#4a90a4', '#7b8b3a' ];

	function initials( name ) {
		const parts = String( name || '?' ).trim().split( /\s+/ );
		return ( ( parts[ 0 ] || '?' )[ 0 ] + ( parts.length > 1 ? parts[ parts.length - 1 ][ 0 ] : '' ) ).toUpperCase();
	}

	function avatar( person, size ) {
		const px = size || 24;
		const name = person ? person.name : '?';
		const color = AVATAR_COLORS[ ( person ? person.id : 0 ) % AVATAR_COLORS.length ];
		const img = person && person.avatar ? '<img src="' + esc( person.avatar ) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
		return '<span class="nf-avatar" style="--size:' + px + 'px;--avatar:' + color + '" title="' + esc( name ) + '"><span class="nf-avatar-initials" aria-hidden="true">' + esc( initials( name ) ) + '</span>' + img + '</span>';
	}

	window.NoteFlowUI = {
		icon,
		esc,
		setLayer,
		menu,
		closeMenu,
		popover,
		closePopover,
		dialog,
		confirm: confirmDialog,
		askText,
		toast,
		listDate,
		dateGroup,
		fullDate,
		mediumDate,
		ago,
		reminderLabel,
		toMarkdown,
		fromMarkdown,
		download,
		slug,
		avatar,
		position,
		isMenuOpen: () => !! openMenuEl,
		hasDialog: () => dialogs.length > 0,
		closeTopDialog: () => dialogs.length && dialogs[ dialogs.length - 1 ](),
	};
}() );
