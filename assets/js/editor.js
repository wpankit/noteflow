/**
 * NoteFlow editor: a small rich-text editor on contenteditable, plus a three-way
 * merge for notes edited by several people at once.
 *
 * Exposes window.NoteFlowEditor and window.NoteFlowMerge.
 */
( function () {
	'use strict';

	const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,pre,blockquote,li,div,td,th,figure';
	const LIST_CLASSES = { dashed: 'nf-dashed', check: 'nf-checklist' };
	const ALLOWED = [ 'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'mark', 'sub', 'sup' ];
	const RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', tt: 'code', h4: 'h3', h5: 'h3', h6: 'h3' };
	const CONTAINERS = [ 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure' ];
	const SKIP = [ 'script', 'style', 'meta', 'link', 'title', 'head', 'noscript', 'iframe', 'object', 'embed', 'svg', 'template', 'button', 'input', 'select', 'textarea', 'form', 'video', 'audio', 'canvas' ];

	const escapeHtml = ( text ) =>
		String( text ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );

	const isMac = /Mac|iPhone|iPad/.test( navigator.platform || navigator.userAgent );

	/**
	 * Removes the inline styles Chrome adds around inserted HTML, and the spans left bare.
	 *
	 * @param {Element} el Element to clean, in place.
	 */
	function stripStyles( el ) {
		el.querySelectorAll( '[style]' ).forEach( ( node ) => node.removeAttribute( 'style' ) );
		el.querySelectorAll( 'span:not([class])' ).forEach( ( span ) => {
			if ( ! span.attributes.length ) {
				span.replaceWith( ...span.childNodes );
			}
		} );
	}

	/**
	 * Cleans pasted HTML down to what notes support.
	 *
	 * @param {string} html Pasted HTML.
	 * @return {string} Clean HTML.
	 */
	function cleanHTML( html ) {
		const doc = new DOMParser().parseFromString( html, 'text/html' );
		const out = document.createElement( 'div' );
		const hasBlocks = ( node ) => !! node.querySelector( 'p,div,ul,ol,table,h1,h2,h3,h4,h5,h6,blockquote,pre,section,article' );

		const walk = ( src, dest ) => {
			for ( const node of Array.from( src.childNodes ) ) {
				if ( node.nodeType === 3 ) {
					dest.appendChild( document.createTextNode( node.nodeValue ) );
					continue;
				}
				if ( node.nodeType !== 1 ) {
					continue;
				}

				const tag = node.tagName.toLowerCase();
				if ( SKIP.includes( tag ) ) {
					continue;
				}

				let target = RENAME[ tag ] || tag;
				const style = node.getAttribute( 'style' ) || '';

				if ( tag === 'b' && /font-weight:\s*(normal|400)/i.test( style ) ) {
					target = null; // Google Docs wraps everything in a non-bold <b>.
				} else if ( tag === 'span' ) {
					if ( /font-weight:\s*(bold|[6-9]00)/i.test( style ) ) {
						target = 'strong';
					} else if ( /font-style:\s*italic/i.test( style ) ) {
						target = 'em';
					} else if ( /line-through/i.test( style ) ) {
						target = 's';
					} else {
						target = null;
					}
				} else if ( CONTAINERS.includes( tag ) ) {
					target = hasBlocks( node ) ? null : 'p';
				} else if ( tag === 'p' && dest.tagName && dest.tagName.toLowerCase() === 'li' ) {
					target = null;
				}

				if ( ! target || ! ALLOWED.includes( target ) ) {
					walk( node, dest );
					continue;
				}

				const el = document.createElement( target );

				if ( target === 'a' ) {
					const href = node.getAttribute( 'href' ) || '';
					if ( ! /^(https?:|mailto:|tel:)/i.test( href ) ) {
						walk( node, dest );
						continue;
					}
					el.setAttribute( 'href', href );
				}
				if ( target === 'img' ) {
					const src = node.getAttribute( 'src' ) || '';
					if ( /^https?:/i.test( src ) ) {
						el.setAttribute( 'src', src );
						el.setAttribute( 'alt', node.getAttribute( 'alt' ) || '' );
						dest.appendChild( el );
					}
					continue;
				}
				if ( target === 'ul' ) {
					[ 'nf-checklist', 'nf-dashed' ].forEach( ( cls ) => node.classList.contains( cls ) && el.classList.add( cls ) );
				}
				if ( target === 'li' && node.classList.contains( 'nf-checked' ) ) {
					el.className = 'nf-checked';
				}

				walk( node, el );
				dest.appendChild( el );
			}
		};

		walk( doc.body, out );
		return out.innerHTML;
	}

	/**
	 * Plain text as paragraphs.
	 *
	 * @param {string} text Text.
	 * @return {string} HTML.
	 */
	function textToHTML( text ) {
		return text
			.replace( /\r\n?/g, '\n' )
			.split( /\n{2,}/ )
			.map( ( para ) => '<p>' + escapeHtml( para ).replace( /\n/g, '<br>' ) + '</p>' )
			.join( '' );
	}

	/**
	 * Editor HTML in a stable form, so versions can be compared.
	 *
	 * @param {string} html HTML.
	 * @return {string} Normalised HTML.
	 */
	function normalize( html ) {
		const box = document.createElement( 'div' );
		box.innerHTML = html || '';

		// Loose text and inline elements at the top level go into paragraphs.
		let para = null;
		Array.from( box.childNodes ).forEach( ( node ) => {
			const inline = node.nodeType === 3 || ( node.nodeType === 1 && ! node.matches( 'p,h1,h2,h3,h4,h5,h6,pre,blockquote,ul,ol,table,hr,div,figure,img' ) );
			if ( inline ) {
				if ( node.nodeType === 3 && ! node.nodeValue.trim() && ! para ) {
					node.remove();
					return;
				}
				if ( ! para ) {
					para = document.createElement( 'p' );
					node.before( para );
				}
				para.appendChild( node );
			} else {
				para = null;
			}
		} );

		box.querySelectorAll( ':scope > div' ).forEach( ( div ) => {
			if ( ! div.querySelector( 'p,ul,ol,table,h1,h2,h3,blockquote,pre' ) ) {
				const p = document.createElement( 'p' );
				p.innerHTML = div.innerHTML;
				div.replaceWith( p );
			}
		} );
		box.querySelectorAll( '[style]' ).forEach( ( el ) => el.removeAttribute( 'style' ) );
		box.querySelectorAll( '[contenteditable],[data-nf-temp]' ).forEach( ( el ) => {
			el.removeAttribute( 'contenteditable' );
			el.removeAttribute( 'data-nf-temp' );
		} );
		box.querySelectorAll( 'span' ).forEach( ( span ) => {
			if ( ! span.attributes.length ) {
				span.replaceWith( ...span.childNodes );
			}
		} );
		box.querySelectorAll( 'font' ).forEach( ( font ) => font.replaceWith( ...font.childNodes ) );
		box.querySelectorAll( '[class=""]' ).forEach( ( el ) => el.removeAttribute( 'class' ) );

		return box.innerHTML.replace( /​/g, '' );
	}

	/**
	 * Rich-text editor.
	 */
	class Editor {
		/**
		 * @param {HTMLElement} root    Element to make editable.
		 * @param {Object}      options Callbacks: onChange, onSelection, onUpload, onLink, onExitStart.
		 */
		constructor( root, options ) {
			this.root = root;
			this.opts = Object.assign(
				{
					onChange() {},
					onSelection() {},
					onUpload: null,
					onLink: null,
					onExitStart: null,
					onLinkQuery: null,
					onLinkKey: null,
					onOpenLink: null,
				},
				options || {}
			);
			this.readOnly = false;
			this.composing = false;

			root.classList.add( 'nf-content' );
			root.setAttribute( 'contenteditable', 'true' );
			root.setAttribute( 'role', 'textbox' );
			root.setAttribute( 'aria-multiline', 'true' );
			root.setAttribute( 'spellcheck', 'true' );

			this.bind();
		}

		bind() {
			const root = this.root;

			root.addEventListener( 'focus', () => {
				try {
					document.execCommand( 'defaultParagraphSeparator', false, 'p' );
				} catch ( e ) {}
			} );
			root.addEventListener( 'input', ( e ) => this.onInput( e ) );
			root.addEventListener( 'keydown', ( e ) => this.onKeyDown( e ) );
			root.addEventListener( 'paste', ( e ) => this.onPaste( e ) );
			root.addEventListener( 'drop', ( e ) => this.onDrop( e ) );
			root.addEventListener( 'mousedown', ( e ) => this.onMouseDown( e ) );
			root.addEventListener( 'click', ( e ) => this.onClick( e ) );
			root.addEventListener( 'compositionstart', () => ( this.composing = true ) );
			root.addEventListener( 'compositionend', () => {
				this.composing = false;
				this.changed();
			} );
			document.addEventListener( 'selectionchange', () => {
				const sel = window.getSelection();
				if ( sel.rangeCount && root.contains( sel.anchorNode ) ) {
					this.lastRange = sel.getRangeAt( 0 ).cloneRange();
					this.opts.onSelection( this.state() );
					if ( this.linkQuery ) {
						this.checkLinkTrigger();
					}
				} else if ( this.linkQuery ) {
					this.closeLinkQuery();
				}
			} );
		}

		/* Content ------------------------------------------------------------ */

		setContent( html ) {
			this.root.innerHTML = normalize( html ) || '<p><br></p>';
			if ( ! this.root.firstElementChild ) {
				this.root.innerHTML = '<p><br></p>';
			}
			this.updateEmpty();
		}

		getContent() {
			const html = normalize( this.root.innerHTML );
			return /^(<p>(<br>)?<\/p>)*$/.test( html ) ? '' : html;
		}

		isEmpty() {
			return ! this.root.textContent.trim() && ! this.root.querySelector( 'img,table,hr,li' );
		}

		updateEmpty() {
			this.root.classList.toggle( 'is-empty', this.isEmpty() );
		}

		setReadOnly( readOnly ) {
			this.readOnly = !! readOnly;
			this.root.setAttribute( 'contenteditable', readOnly ? 'false' : 'true' );
			this.root.setAttribute( 'aria-readonly', readOnly ? 'true' : 'false' );
		}

		focus( where ) {
			this.root.focus();
			const sel = window.getSelection();
			const range = document.createRange();
			range.selectNodeContents( this.root );
			range.collapse( where !== 'end' );
			sel.removeAllRanges();
			sel.addRange( range );
		}

		changed() {
			this.updateEmpty();
			if ( ! this.composing ) {
				this.opts.onChange();
			}
		}

		/* Selection helpers ----------------------------------------------------- */

		range() {
			const sel = window.getSelection();
			if ( sel.rangeCount && this.root.contains( sel.getRangeAt( 0 ).commonAncestorContainer ) ) {
				return sel.getRangeAt( 0 );
			}
			return null;
		}

		/** Puts the caret back where it was before a toolbar click or dialog. */
		restoreRange() {
			if ( this.range() ) {
				return;
			}
			this.root.focus();
			if ( this.lastRange && this.root.contains( this.lastRange.commonAncestorContainer ) ) {
				const sel = window.getSelection();
				sel.removeAllRanges();
				sel.addRange( this.lastRange );
			} else {
				this.focus( 'end' );
			}
		}

		closest( selector ) {
			const range = this.range() || this.lastRange;
			if ( ! range ) {
				return null;
			}
			let node = range.startContainer;
			node = node.nodeType === 3 ? node.parentNode : node;
			const found = node && node.closest ? node.closest( selector ) : null;
			return found && this.root.contains( found ) && found !== this.root ? found : null;
		}

		block() {
			return this.closest( BLOCKS );
		}

		list() {
			return this.closest( 'ul,ol' );
		}

		listKind( list ) {
			if ( ! list ) {
				return '';
			}
			if ( list.tagName === 'OL' ) {
				return 'ol';
			}
			if ( list.classList.contains( 'nf-checklist' ) ) {
				return 'check';
			}
			return list.classList.contains( 'nf-dashed' ) ? 'dashed' : 'ul';
		}

		/** What is active at the caret, for the toolbar. */
		state() {
			const block = this.block();
			const q = ( cmd ) => {
				try {
					return document.queryCommandState( cmd );
				} catch ( e ) {
					return false;
				}
			};
			let tag = block ? block.tagName.toLowerCase() : 'p';
			if ( tag === 'li' || tag === 'div' || tag === 'td' || tag === 'th' ) {
				tag = 'p';
			}
			const link = this.closest( 'a' );
			return {
				block: tag,
				list: this.listKind( this.list() ),
				bold: q( 'bold' ),
				italic: q( 'italic' ),
				underline: q( 'underline' ),
				strike: q( 'strikeThrough' ),
				code: !! this.closest( 'code' ),
				mark: !! this.closest( 'mark' ),
				link: link ? link.getAttribute( 'href' ) : '',
				table: !! this.closest( 'td,th' ),
			};
		}

		/**
		 * Caret position that survives the content being replaced: the block's text and
		 * index, and the offset inside it.
		 */
		getCaret() {
			const range = this.range();
			if ( ! range ) {
				return null;
			}
			const top = this.topBlock( range.startContainer );
			if ( ! top ) {
				return null;
			}
			const pre = document.createRange();
			pre.selectNodeContents( top );
			pre.setEnd( range.startContainer, range.startOffset );
			return {
				index: Array.prototype.indexOf.call( this.root.children, top ),
				text: top.textContent,
				offset: pre.toString().length,
			};
		}

		setCaret( caret ) {
			if ( ! caret ) {
				return;
			}
			const blocks = Array.from( this.root.children );
			let target = null;
			let best = Infinity;
			blocks.forEach( ( block, i ) => {
				if ( block.textContent === caret.text && Math.abs( i - caret.index ) < best ) {
					best = Math.abs( i - caret.index );
					target = block;
				}
			} );
			target = target || blocks[ Math.min( caret.index, blocks.length - 1 ) ];
			if ( ! target ) {
				return;
			}

			const walker = document.createTreeWalker( target, NodeFilter.SHOW_TEXT );
			let left = caret.offset;
			let node = walker.nextNode();
			const range = document.createRange();
			// With no text to land in, go inside the first item or cell, never between them.
			range.setStart( ( target.matches( 'ul,ol,table' ) && target.querySelector( 'li,td,th' ) ) || target, 0 );
			while ( node ) {
				if ( left <= node.nodeValue.length ) {
					range.setStart( node, left );
					break;
				}
				left -= node.nodeValue.length;
				node = walker.nextNode();
			}
			range.collapse( true );
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange( range );
		}

		topBlock( node ) {
			while ( node && node.parentNode !== this.root ) {
				node = node.parentNode;
			}
			return node && node.nodeType === 1 ? node : null;
		}

		/* Commands ------------------------------------------------------------- */

		exec( command, value ) {
			if ( this.readOnly ) {
				return;
			}
			this.restoreRange();
			document.execCommand( command, false, value === undefined ? null : value );
			this.changed();
		}

		/** Bold, italic, underline, strikethrough, inline code or highlight. */
		inline( kind ) {
			if ( this.readOnly ) {
				return;
			}
			const native = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough' };
			if ( native[ kind ] ) {
				this.exec( native[ kind ] );
				return;
			}
			this.wrapInline( kind === 'code' ? 'code' : 'mark' );
		}

		wrapInline( tag ) {
			this.restoreRange();
			const existing = this.closest( tag );
			if ( existing ) {
				existing.replaceWith( ...existing.childNodes );
				this.changed();
				return;
			}
			const range = this.range();
			if ( ! range || range.collapsed ) {
				return;
			}
			const box = document.createElement( 'div' );
			box.appendChild( range.cloneContents() );
			if ( box.querySelector( 'p,li,h1,h2,h3,pre,blockquote,table,ul,ol' ) ) {
				return; // Inline styles don't span blocks.
			}
			document.execCommand( 'insertHTML', false, '<' + tag + '>' + box.innerHTML + '</' + tag + '>' );
			this.changed();
		}

		/*
		 * Block changes. Browsers' own list commands nest lists inside paragraphs, so
		 * NoteFlow builds lists and block styles itself: turning paragraphs into a list
		 * or a heading replaces them with insertHTML (which keeps undo working), and
		 * turning list items back into paragraphs moves the nodes directly.
		 */

		/** Top-level text blocks (paragraphs, headings, quotes, code) covered by the selection. */
		selectedBlocks() {
			const range = this.range() || this.lastRange;
			if ( ! range ) {
				return [];
			}
			const first = this.topBlock( range.startContainer );
			const last = this.topBlock( range.endContainer ) || first;
			if ( ! first ) {
				return [];
			}
			const blocks = [];
			for ( let node = first; node; node = node.nextElementSibling ) {
				blocks.push( node );
				if ( node === last ) {
					break;
				}
			}
			return blocks.every( ( b ) => /^(P|DIV|H[1-6]|PRE|BLOCKQUOTE)$/.test( b.tagName ) ) ? blocks : [ first ].filter( ( b ) => /^(P|DIV|H[1-6]|PRE|BLOCKQUOTE)$/.test( b.tagName ) );
		}

		/** List items covered by the selection, in one list. */
		selectedItems( list ) {
			const range = this.range() || this.lastRange;
			const items = Array.from( list.children ).filter( ( li ) => li.tagName === 'LI' );
			const within = items.filter( ( li ) => range && range.intersectsNode( li ) );
			return within.length ? within : items.slice( 0, 1 );
		}

		/** Replaces whole top-level blocks with new HTML, as one undoable step. */
		replaceBlocks( blocks, html ) {
			const caret = this.getCaret();
			const range = document.createRange();
			range.setStartBefore( blocks[ 0 ] );
			range.setEndAfter( blocks[ blocks.length - 1 ] );
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange( range );
			document.execCommand( 'insertHTML', false, html );
			this.setCaret( caret );
		}

		/** Inline HTML of a block, as list item or new block content. */
		inner( block ) {
			const clone = block.cloneNode( true );
			stripStyles( clone );
			const html = clone.innerHTML.trim();
			return html === '' ? '<br>' : html;
		}

		/** Cleans up after an insert: inline styles and bare spans in the block at the caret. */
		tidy() {
			const range = this.range();
			const top = range ? this.topBlock( range.startContainer ) : null;
			if ( ! top || ! top.querySelector( '[style]' ) ) {
				return;
			}
			const caret = this.getCaret();
			stripStyles( top );
			this.setCaret( caret );
		}

		/** Turns list items into blocks of the given tag, splitting the list around them. */
		unlist( list, items, tag ) {
			const range = this.range() || this.lastRange;
			const saved = range ? { node: range.startContainer, offset: range.startOffset } : null;
			const children = Array.from( list.children );
			const after = children.slice( children.indexOf( items[ items.length - 1 ] ) + 1 );
			const keepHead = children.indexOf( items[ 0 ] ) > 0;
			const out = document.createDocumentFragment();
			let firstBlock = null;

			items.forEach( ( li ) => {
				const block = document.createElement( tag );
				const nested = [];
				Array.from( li.childNodes ).forEach( ( node ) => ( node.nodeType === 1 && /^(UL|OL)$/.test( node.tagName ) ? nested.push( node ) : block.appendChild( node ) ) );
				if ( ! block.textContent.trim() && ! block.querySelector( 'img,br' ) ) {
					block.innerHTML = '<br>';
				}
				out.appendChild( block );
				nested.forEach( ( node ) => out.appendChild( node ) );
				firstBlock = firstBlock || block;
				li.remove();
			} );

			if ( after.length ) {
				const tail = list.cloneNode( false );
				after.forEach( ( node ) => tail.appendChild( node ) );
				list.after( tail );
			}
			list.after( out );
			if ( ! keepHead ) {
				list.remove();
			}

			if ( saved && this.root.contains( saved.node ) ) {
				const r = document.createRange();
				r.setStart( saved.node, Math.min( saved.offset, saved.node.nodeType === 3 ? saved.node.length : saved.node.childNodes.length ) );
				r.collapse( true );
				const sel = window.getSelection();
				sel.removeAllRanges();
				sel.addRange( r );
			} else if ( firstBlock ) {
				this.caretIn( firstBlock );
			}
		}

		/** Paragraph style: h1 (title), h2 (heading), h3 (subheading), p, pre, blockquote. */
		setBlock( tag ) {
			if ( this.readOnly ) {
				return;
			}
			this.restoreRange();

			const list = this.list();
			if ( list ) {
				this.unlist( list, this.selectedItems( list ), tag );
				this.changed();
				return;
			}

			const blocks = this.selectedBlocks();
			if ( ! blocks.length ) {
				return;
			}
			if ( tag !== 'p' && blocks.every( ( b ) => b.tagName.toLowerCase() === tag ) ) {
				tag = 'p';
			}
			this.replaceBlocks( blocks, blocks.map( ( b ) => '<' + tag + '>' + this.inner( b ) + '</' + tag + '>' ).join( '' ) );
			this.changed();
		}

		/** Lists: ul, ol, dashed or check. Choosing the current kind turns the list off. */
		toggleList( kind ) {
			if ( this.readOnly ) {
				return;
			}
			this.restoreRange();

			const tag = kind === 'ol' ? 'ol' : 'ul';
			const cls = LIST_CLASSES[ kind ] || '';
			const list = this.list();

			if ( list ) {
				const current = this.listKind( list );
				if ( current === kind ) {
					this.unlist( list, this.selectedItems( list ), 'p' );
				} else if ( list.tagName.toLowerCase() === tag ) {
					this.setListClass( list, kind, cls );
				} else {
					const range = this.range() || this.lastRange;
					const saved = range ? { node: range.startContainer, offset: range.startOffset } : null;
					const fresh = document.createElement( tag );
					Array.from( list.childNodes ).forEach( ( node ) => fresh.appendChild( node ) );
					list.replaceWith( fresh );
					this.setListClass( fresh, kind, cls );
					if ( saved && this.root.contains( saved.node ) ) {
						const r = document.createRange();
						r.setStart( saved.node, saved.offset );
						r.collapse( true );
						window.getSelection().removeAllRanges();
						window.getSelection().addRange( r );
					}
				}
				this.changed();
				return;
			}

			const blocks = this.selectedBlocks();
			if ( ! blocks.length ) {
				return;
			}
			const open = '<' + tag + ( cls ? ' class="' + cls + '"' : '' ) + '>';
			this.replaceBlocks( blocks, open + blocks.map( ( b ) => '<li>' + this.inner( b ) + '</li>' ).join( '' ) + '</' + tag + '>' );
			this.changed();
		}

		setListClass( list, kind, cls ) {
			list.classList.remove( 'nf-dashed', 'nf-checklist' );
			if ( cls ) {
				list.classList.add( cls );
			}
			if ( kind !== 'check' ) {
				list.querySelectorAll( 'li.nf-checked' ).forEach( ( li ) => li.classList.remove( 'nf-checked' ) );
			}
			if ( ! list.getAttribute( 'class' ) ) {
				list.removeAttribute( 'class' );
			}
		}

		/** Moves ticked checklist items below the unticked ones. */
		moveCheckedDown() {
			let moved = false;
			this.root.querySelectorAll( 'ul.nf-checklist' ).forEach( ( list ) => {
				const items = Array.from( list.children );
				const done = items.filter( ( li ) => li.classList.contains( 'nf-checked' ) );
				const todo = items.filter( ( li ) => ! li.classList.contains( 'nf-checked' ) );
				if ( done.length && items.indexOf( done[ 0 ] ) < todo.length ) {
					todo.concat( done ).forEach( ( li ) => list.appendChild( li ) );
					moved = true;
				}
			} );
			if ( moved ) {
				this.changed();
			}
			return moved;
		}

		/** Unticks every checklist item. */
		uncheckAll() {
			const items = this.root.querySelectorAll( 'ul.nf-checklist > li.nf-checked' );
			items.forEach( ( li ) => li.classList.remove( 'nf-checked' ) );
			if ( items.length ) {
				this.changed();
			}
		}

		insertHTML( html ) {
			if ( this.readOnly ) {
				return;
			}
			this.restoreRange();
			document.execCommand( 'insertHTML', false, html );
			this.tidy();
			this.changed();
		}

		insertImage( url, alt ) {
			this.insertHTML( '<img src="' + escapeHtml( url ) + '" alt="' + escapeHtml( alt || '' ) + '">' );
		}

		insertTable( rows, cols ) {
			rows = rows || 3;
			cols = cols || 3;
			let html = '<table class="nf-table"><tbody>';
			for ( let r = 0; r < rows; r++ ) {
				html += '<tr>' + '<td><br></td>'.repeat( cols ) + '</tr>';
			}
			html += '</tbody></table><p><br></p>';
			this.insertHTML( html );

			const tables = this.root.querySelectorAll( 'table' );
			const range = this.range();
			let table = null;
			tables.forEach( ( t ) => {
				if ( range && t.compareDocumentPosition( range.startContainer ) & Node.DOCUMENT_POSITION_FOLLOWING ) {
					table = t;
				}
			} );
			const cell = ( table || tables[ tables.length - 1 ] )?.querySelector( 'td' );
			if ( cell ) {
				this.caretIn( cell );
			}
		}

		caretIn( el, atEnd ) {
			const range = document.createRange();
			range.selectNodeContents( el );
			range.collapse( ! atEnd );
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange( range );
		}

		/** Row and column actions for the table at the caret. */
		tableAction( action ) {
			if ( this.readOnly ) {
				return;
			}
			const cell = this.closest( 'td,th' );
			if ( ! cell ) {
				return;
			}
			const row = cell.parentNode;
			const table = cell.closest( 'table' );
			const index = Array.prototype.indexOf.call( row.children, cell );
			const blankRow = () => {
				const clone = row.cloneNode( true );
				clone.querySelectorAll( 'td,th' ).forEach( ( c ) => ( c.innerHTML = '<br>' ) );
				return clone;
			};

			switch ( action ) {
				case 'row-above':
					row.before( blankRow() );
					break;
				case 'row-below':
					row.after( blankRow() );
					break;
				case 'col-left':
				case 'col-right':
					table.querySelectorAll( 'tr' ).forEach( ( tr ) => {
						const ref = tr.children[ index ];
						const fresh = document.createElement( ref ? ref.tagName.toLowerCase() : 'td' );
						fresh.innerHTML = '<br>';
						if ( ! ref ) {
							tr.appendChild( fresh );
						} else if ( action === 'col-left' ) {
							ref.before( fresh );
						} else {
							ref.after( fresh );
						}
					} );
					break;
				case 'row-delete':
					if ( table.querySelectorAll( 'tr' ).length > 1 ) {
						row.remove();
					} else {
						table.remove();
					}
					break;
				case 'col-delete':
					if ( row.children.length > 1 ) {
						table.querySelectorAll( 'tr' ).forEach( ( tr ) => tr.children[ index ] && tr.children[ index ].remove() );
					} else {
						table.remove();
					}
					break;
				case 'delete':
					table.remove();
					break;
			}
			this.changed();
		}

		/** Adds, changes or removes (empty url) the link at the selection. */
		setLink( url, text ) {
			if ( this.readOnly ) {
				return;
			}
			this.restoreRange();
			const existing = this.closest( 'a' );

			if ( ! url ) {
				if ( existing ) {
					existing.replaceWith( ...existing.childNodes );
					this.changed();
				}
				return;
			}
			if ( ! /^[a-z][a-z0-9+.-]*:/i.test( url ) && ! url.startsWith( '/' ) && ! url.startsWith( '#' ) ) {
				url = ( /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( url ) ? 'mailto:' : 'https://' ) + url;
			}
			if ( ! /^(https?:|mailto:|tel:|\/|#)/i.test( url ) ) {
				return;
			}

			const range = this.range();
			if ( existing ) {
				existing.setAttribute( 'href', url );
				if ( text && text !== existing.textContent ) {
					existing.textContent = text;
				}
			} else if ( ! range || range.collapsed ) {
				document.execCommand( 'insertHTML', false, '<a href="' + escapeHtml( url ) + '">' + escapeHtml( text || url ) + '</a>&nbsp;' );
			} else {
				document.execCommand( 'createLink', false, url );
			}
			this.tidy();
			this.changed();
		}

		selectedText() {
			const range = this.range() || this.lastRange;
			return range ? range.toString() : '';
		}

		/* Events -------------------------------------------------------------- */

		onInput( e ) {
			if ( e.inputType === 'insertParagraph' ) {
				const li = this.closest( 'li' );
				if ( li && li.classList.contains( 'nf-checked' ) && ! li.textContent.trim() ) {
					li.classList.remove( 'nf-checked' );
				}
			}
			// Browsers sometimes leave a bare <br> or text at the top level.
			if ( ! this.root.firstElementChild ) {
				this.root.innerHTML = '<p><br></p>';
				this.focus( 'start' );
			}
			this.changed();
			this.checkLinkTrigger();
		}

		/* Link suggestions: typing [[ opens a list of notes and content to link to. */

		checkLinkTrigger() {
			if ( ! this.opts.onLinkQuery || this.readOnly ) {
				return;
			}
			const range = this.range();
			const node = range && range.collapsed ? range.startContainer : null;
			const match = node && node.nodeType === 3 ? node.nodeValue.slice( 0, range.startOffset ).match( /\[\[([^\[\]\n]{0,60})$/ ) : null;
			if ( ! match || this.closest( 'pre,code' ) ) {
				if ( this.linkQuery ) {
					this.closeLinkQuery();
				}
				return;
			}
			this.linkQuery = { node, start: range.startOffset - match[ 0 ].length, end: range.startOffset, query: match[ 1 ] };
			const rects = range.getClientRects();
			const rect = rects.length ? rects[ rects.length - 1 ] : node.parentNode.getBoundingClientRect();
			this.opts.onLinkQuery( { query: match[ 1 ], rect } );
		}

		closeLinkQuery() {
			this.linkQuery = null;
			if ( this.opts.onLinkQuery ) {
				this.opts.onLinkQuery( null );
			}
		}

		/** Replaces the typed [[query with a link. */
		insertLinkFromQuery( url, title ) {
			const q = this.linkQuery;
			if ( ! q || ! this.root.contains( q.node ) ) {
				this.closeLinkQuery();
				return;
			}
			this.root.focus();
			const range = document.createRange();
			range.setStart( q.node, Math.min( q.start, q.node.length ) );
			range.setEnd( q.node, Math.min( q.end, q.node.length ) );
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange( range );
			document.execCommand( 'insertHTML', false, '<a href="' + escapeHtml( url ) + '">' + escapeHtml( title ) + '</a>&nbsp;' );
			this.tidy();
			this.closeLinkQuery();
			this.changed();
		}

		onKeyDown( e ) {
			if ( this.readOnly || this.composing ) {
				return;
			}
			if ( this.linkQuery && this.opts.onLinkKey && this.opts.onLinkKey( e ) ) {
				e.preventDefault();
				return;
			}
			const mod = isMac ? e.metaKey : e.ctrlKey;

			if ( e.key === ' ' && ! mod && ! e.altKey && this.markdownShortcut( e ) ) {
				return;
			}

			if ( mod && ! e.altKey ) {
				const key = e.key.toLowerCase();
				if ( key === 'k' ) {
					e.preventDefault();
					if ( this.opts.onLink ) {
						this.opts.onLink();
					}
					return;
				}
				if ( e.shiftKey ) {
					const shifted = { KeyL: () => this.toggleList( 'check' ), Digit7: () => this.toggleList( 'ol' ), Digit8: () => this.toggleList( 'ul' ), KeyX: () => this.inline( 'strike' ), KeyH: () => this.inline( 'mark' ) }[ e.code ];
					if ( shifted ) {
						e.preventDefault();
						shifted();
						return;
					}
				} else if ( key === 'e' ) {
					e.preventDefault();
					this.inline( 'code' );
					return;
				}
			}

			if ( mod && e.altKey ) {
				const block = { Digit1: 'h1', Digit2: 'h2', Digit3: 'h3', Digit0: 'p', Digit9: 'pre' }[ e.code ];
				if ( block ) {
					e.preventDefault();
					this.setBlock( block );
					return;
				}
			}

			if ( e.key === 'Tab' ) {
				this.onTab( e );
				return;
			}

			if ( e.key === 'Enter' && ! e.shiftKey ) {
				this.onEnter( e );
				return;
			}

			if ( e.key === 'Backspace' && this.onBackspace( e ) ) {
				return;
			}

			if ( e.key === 'ArrowUp' && this.opts.onExitStart ) {
				const range = this.range();
				if ( range && range.collapsed ) {
					const first = this.root.firstElementChild;
					const rect = range.getClientRects()[ 0 ];
					const top = first ? first.getBoundingClientRect().top : 0;
					if ( ! first || ( rect && rect.top - top < 8 ) || ( ! rect && this.topBlock( range.startContainer ) === first ) ) {
						e.preventDefault();
						this.opts.onExitStart();
					}
				}
			}
		}

		onTab( e ) {
			const cell = this.closest( 'td,th' );
			if ( cell ) {
				e.preventDefault();
				const cells = Array.from( cell.closest( 'table' ).querySelectorAll( 'td,th' ) );
				let next = cells[ cells.indexOf( cell ) + ( e.shiftKey ? -1 : 1 ) ];
				if ( ! next && ! e.shiftKey ) {
					this.tableAction( 'row-below' );
					next = cell.parentNode.nextElementSibling?.firstElementChild;
				}
				if ( next ) {
					this.caretIn( next, true );
				}
				return;
			}
			if ( this.closest( 'li' ) ) {
				e.preventDefault();
				document.execCommand( e.shiftKey ? 'outdent' : 'indent' );
				// A nested list takes the style of the list around it.
				const list = this.list();
				const parent = list && list.parentElement ? list.parentElement.closest( 'ul,ol' ) : null;
				if ( list && parent && parent.tagName === list.tagName ) {
					[ 'nf-checklist', 'nf-dashed' ].forEach( ( cls ) => list.classList.toggle( cls, parent.classList.contains( cls ) ) );
					if ( ! list.getAttribute( 'class' ) ) {
						list.removeAttribute( 'class' );
					}
				}
				this.changed();
			}
		}

		/**
		 * Backspace at the start of a line: a first list item or a heading becomes a
		 * paragraph, and an empty note hands focus back to the title.
		 *
		 * @return {boolean} Whether the key was handled.
		 */
		onBackspace( e ) {
			const range = this.range();
			if ( ! range || ! range.collapsed ) {
				return false;
			}
			const block = this.block();
			if ( block ) {
				const pre = document.createRange();
				pre.selectNodeContents( block );
				pre.setEnd( range.startContainer, range.startOffset );
				if ( pre.toString() === '' && ! pre.cloneContents().querySelector( 'img' ) ) {
					if ( block.tagName === 'LI' && block.parentNode.firstElementChild === block && block.parentNode.parentNode === this.root ) {
						e.preventDefault();
						this.unlist( block.parentNode, [ block ], 'p' );
						this.changed();
						return true;
					}
					if ( /^(H[1-6]|PRE|BLOCKQUOTE)$/.test( block.tagName ) && block.parentNode === this.root ) {
						e.preventDefault();
						this.setBlock( 'p' );
						return true;
					}
				}
			}
			if ( this.opts.onExitStart && this.isEmpty() ) {
				e.preventDefault();
				this.opts.onExitStart();
				return true;
			}
			return false;
		}

		onEnter( e ) {
			// Leave a code block by pressing Enter on an empty last line.
			const pre = this.closest( 'pre' );
			if ( pre ) {
				const range = this.range();
				const after = document.createRange();
				after.selectNodeContents( pre );
				after.setStart( range.endContainer, range.endOffset );
				if ( ! after.toString() && /\n$/.test( pre.textContent ) ) {
					e.preventDefault();
					pre.textContent = pre.textContent.replace( /\n$/, '' );
					const p = document.createElement( 'p' );
					p.innerHTML = '<br>';
					pre.after( p );
					this.caretIn( p );
					this.changed();
				} else {
					e.preventDefault();
					document.execCommand( 'insertText', false, '\n' );
				}
				return;
			}

			// An empty quote line ends the quote.
			const quote = this.closest( 'blockquote' );
			if ( quote && ! this.block()?.textContent.trim() && quote.textContent.trim() ) {
				const block = this.block();
				if ( block && block !== quote && block === quote.lastElementChild ) {
					e.preventDefault();
					block.remove();
					const p = document.createElement( 'p' );
					p.innerHTML = '<br>';
					quote.after( p );
					this.caretIn( p );
					this.changed();
				}
			}
		}

		/** Markdown-style shortcuts typed at the start of a paragraph. */
		markdownShortcut( e ) {
			const range = this.range();
			const block = this.block();
			if ( ! range || ! range.collapsed || ! block || block.tagName !== 'P' || block.parentNode !== this.root ) {
				return false;
			}
			const pre = document.createRange();
			pre.selectNodeContents( block );
			pre.setEnd( range.endContainer, range.endOffset );
			const marker = pre.toString();

			const actions = {
				'-': () => this.toggleList( 'ul' ),
				'*': () => this.toggleList( 'ul' ),
				'--': () => this.toggleList( 'dashed' ),
				'1.': () => this.toggleList( 'ol' ),
				'[]': () => this.toggleList( 'check' ),
				'[ ]': () => this.toggleList( 'check' ),
				'#': () => this.setBlock( 'h1' ),
				'##': () => this.setBlock( 'h2' ),
				'###': () => this.setBlock( 'h3' ),
				'>': () => this.setBlock( 'blockquote' ),
				'```': () => this.setBlock( 'pre' ),
			};
			const action = actions[ marker ];
			if ( ! action ) {
				return false;
			}

			e.preventDefault();
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange( pre );
			document.execCommand( 'delete' );
			action();
			return true;
		}

		onMouseDown( e ) {
			const li = e.target.closest && e.target.closest( 'ul.nf-checklist > li' );
			if ( ! li || ! this.root.contains( li ) ) {
				return;
			}
			const rect = li.getBoundingClientRect();
			const rtl = getComputedStyle( li ).direction === 'rtl';
			const x = rtl ? rect.right - e.clientX : e.clientX - rect.left;
			if ( x < 26 && e.clientY - rect.top < 26 ) {
				e.preventDefault();
				if ( ! this.readOnly ) {
					li.classList.toggle( 'nf-checked' );
					this.changed();
				}
			}
		}

		onClick( e ) {
			const link = e.target.closest && e.target.closest( 'a[href]' );
			if ( link && this.root.contains( link ) && ( this.readOnly || e.metaKey || e.ctrlKey ) ) {
				e.preventDefault();
				if ( this.opts.onOpenLink && this.opts.onOpenLink( link.href ) ) {
					return;
				}
				window.open( link.href, '_blank', 'noopener,noreferrer' );
			}
		}

		onPaste( e ) {
			if ( this.readOnly ) {
				return;
			}
			const data = e.clipboardData;
			if ( ! data ) {
				return;
			}

			const images = Array.from( data.files || [] ).filter( ( file ) => file.type.indexOf( 'image/' ) === 0 );
			if ( images.length ) {
				e.preventDefault();
				if ( this.opts.onUpload ) {
					images.forEach( ( file ) => this.opts.onUpload( file ) );
				}
				return;
			}

			const html = data.getData( 'text/html' );
			const text = data.getData( 'text/plain' );
			e.preventDefault();

			const range = this.range();
			if ( text && /^https?:\/\/\S+$/i.test( text.trim() ) && range && ! range.collapsed ) {
				document.execCommand( 'createLink', false, text.trim() );
			} else if ( html ) {
				document.execCommand( 'insertHTML', false, cleanHTML( html ) );
			} else if ( text ) {
				if ( /\n/.test( text ) ) {
					document.execCommand( 'insertHTML', false, textToHTML( text ) );
				} else {
					document.execCommand( 'insertText', false, text );
				}
			}
			this.tidy();
			this.changed();
		}

		onDrop( e ) {
			if ( this.readOnly ) {
				e.preventDefault();
				return;
			}
			const files = Array.from( ( e.dataTransfer && e.dataTransfer.files ) || [] ).filter( ( file ) => file.type.indexOf( 'image/' ) === 0 );
			const html = e.dataTransfer && e.dataTransfer.getData( 'text/html' );
			if ( ! files.length && ! html ) {
				return;
			}
			e.preventDefault();

			let range = null;
			if ( document.caretRangeFromPoint ) {
				range = document.caretRangeFromPoint( e.clientX, e.clientY );
			} else if ( document.caretPositionFromPoint ) {
				const pos = document.caretPositionFromPoint( e.clientX, e.clientY );
				range = document.createRange();
				range.setStart( pos.offsetNode, pos.offset );
			}
			if ( range ) {
				const sel = window.getSelection();
				sel.removeAllRanges();
				sel.addRange( range );
			}

			if ( files.length ) {
				if ( this.opts.onUpload ) {
					files.forEach( ( file ) => this.opts.onUpload( file ) );
				}
			} else {
				document.execCommand( 'insertHTML', false, cleanHTML( html ) );
				this.changed();
			}
		}
	}

	/* Merge ----------------------------------------------------------------------- */

	/**
	 * Splits note HTML into blocks. Lists and tables are split into items and rows,
	 * so two people can tick different items of the same checklist.
	 *
	 * @param {string} html HTML.
	 * @return {string[]} Tokens.
	 */
	function tokens( html ) {
		const box = document.createElement( 'div' );
		box.innerHTML = normalize( html );
		const out = [];
		const open = ( el ) => el.outerHTML.slice( 0, el.outerHTML.indexOf( '>' ) + 1 );

		Array.from( box.childNodes ).forEach( ( node ) => {
			if ( node.nodeType !== 1 ) {
				if ( node.nodeValue && node.nodeValue.trim() ) {
					out.push( escapeHtml( node.nodeValue ) );
				}
				return;
			}
			const tag = node.tagName;
			if ( ( tag === 'UL' || tag === 'OL' ) && Array.from( node.children ).every( ( li ) => li.tagName === 'LI' ) ) {
				out.push( open( node ) );
				Array.from( node.children ).forEach( ( li ) => out.push( li.outerHTML ) );
				out.push( '</' + tag.toLowerCase() + '>' );
			} else if ( tag === 'TABLE' && node.children.length === 1 && node.firstElementChild.tagName === 'TBODY' ) {
				out.push( open( node ) + '<tbody>' );
				Array.from( node.firstElementChild.children ).forEach( ( tr ) => out.push( tr.outerHTML ) );
				out.push( '</tbody></table>' );
			} else {
				out.push( node.outerHTML );
			}
		} );
		return out;
	}

	/**
	 * Longest common subsequence of two token lists, as matched index pairs.
	 *
	 * @param {string[]} a First list.
	 * @param {string[]} b Second list.
	 * @return {number[][]} Pairs [indexInA, indexInB].
	 */
	function lcs( a, b ) {
		// Trim the shared start and end first; most edits touch a few blocks.
		let start = 0;
		while ( start < a.length && start < b.length && a[ start ] === b[ start ] ) {
			start++;
		}
		let endA = a.length;
		let endB = b.length;
		while ( endA > start && endB > start && a[ endA - 1 ] === b[ endB - 1 ] ) {
			endA--;
			endB--;
		}

		const n = endA - start;
		const m = endB - start;
		const table = [];
		for ( let i = 0; i <= n; i++ ) {
			table.push( new Uint16Array( m + 1 ) );
		}
		for ( let i = n - 1; i >= 0; i-- ) {
			for ( let j = m - 1; j >= 0; j-- ) {
				table[ i ][ j ] = a[ start + i ] === b[ start + j ] ? table[ i + 1 ][ j + 1 ] + 1 : Math.max( table[ i + 1 ][ j ], table[ i ][ j + 1 ] );
			}
		}

		const pairs = [];
		for ( let k = 0; k < start; k++ ) {
			pairs.push( [ k, k ] );
		}
		let i = 0;
		let j = 0;
		while ( i < n && j < m ) {
			if ( a[ start + i ] === b[ start + j ] ) {
				pairs.push( [ start + i, start + j ] );
				i++;
				j++;
			} else if ( table[ i + 1 ][ j ] >= table[ i ][ j + 1 ] ) {
				i++;
			} else {
				j++;
			}
		}
		for ( let k = 0; k < a.length - endA; k++ ) {
			pairs.push( [ endA + k, endB + k ] );
		}
		return pairs;
	}

	/**
	 * Three-way merge of note HTML.
	 *
	 * Changes to different blocks (paragraphs, list items, table rows) are combined.
	 * When both sides changed the same block differently, the merge reports a conflict.
	 *
	 * @param {string} base   The version both sides started from.
	 * @param {string} mine   This person's version.
	 * @param {string} theirs The latest saved version.
	 * @return {{html: string, conflict: boolean}} Result.
	 */
	function merge( base, mine, theirs ) {
		const o = tokens( base );
		const a = tokens( mine );
		const b = tokens( theirs );

		const inA = new Map( lcs( o, a ) );
		const inB = new Map( lcs( o, b ) );

		const same = ( x, y ) => x.length === y.length && x.every( ( t, i ) => t === y[ i ] );
		const out = [];
		let conflict = false;
		let io = 0;
		let ia = 0;
		let ib = 0;

		const resolve = ( co, ca, cb ) => {
			if ( same( ca, co ) ) {
				out.push( ...cb );
			} else if ( same( cb, co ) || same( ca, cb ) ) {
				out.push( ...ca );
			} else {
				conflict = true;
				out.push( ...ca );
			}
		};

		for ( let i = 0; i < o.length; i++ ) {
			if ( ! inA.has( i ) || ! inB.has( i ) ) {
				continue;
			}
			const ja = inA.get( i );
			const jb = inB.get( i );
			if ( ja < ia || jb < ib ) {
				continue;
			}
			resolve( o.slice( io, i ), a.slice( ia, ja ), b.slice( ib, jb ) );
			out.push( o[ i ] );
			io = i + 1;
			ia = ja + 1;
			ib = jb + 1;
		}
		resolve( o.slice( io ), a.slice( ia ), b.slice( ib ) );

		return { html: normalize( out.join( '' ) ), conflict };
	}

	window.NoteFlowEditor = Editor;
	window.NoteFlowMerge = { merge, normalize, tokens };
	window.NoteFlowHTML = { clean: cleanHTML, fromText: textToHTML, escape: escapeHtml, normalize };
}() );
