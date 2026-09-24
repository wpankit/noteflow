/**
 * NoteFlow in the block editor: a sidebar with the post's discussion and notes, a
 * Comment button in the block toolbar, and a highlight on blocks with open threads.
 *
 * The panel itself is the same one the classic editor uses (discussions.js). It lives
 * outside React so it keeps its drafts and keeps the highlights fresh while the
 * sidebar is closed; the sidebar only shows it.
 */
( function ( wp ) {
	'use strict';

	const config = window.noteflowDiscussion;
	const EditorPlugins = ( wp.editor && wp.editor.PluginSidebar ) ? wp.editor : wp.editPost;
	if ( ! config || ! window.NoteFlowDiscussion || ! wp.plugins || ! EditorPlugins || ! EditorPlugins.PluginSidebar ) {
		return;
	}

	const { createElement: el, Fragment, useEffect, useRef } = wp.element;
	const { __, _n, sprintf } = wp.i18n;
	const { select, dispatch, subscribe, useSelect } = wp.data;
	const { addFilter } = wp.hooks;
	const { createHigherOrderComponent } = wp.compose;
	const { BlockControls } = wp.blockEditor;
	const { ToolbarButton } = wp.components;
	const { PluginSidebar, PluginSidebarMoreMenuItem } = EditorPlugins;

	const STORE = 'noteflow/discussions';
	const SIDEBAR = 'noteflow-sidebar';
	const KEY = 'noteflowId';

	/* A small store with the open threads per block, for the highlights and the badge. */

	const storeConfig = {
		reducer( state = { anchors: {}, open: 0 }, action ) {
			return 'NOTEFLOW_SET' === action.type ? { anchors: action.anchors, open: action.open } : state;
		},
		actions: {
			set( anchors, open ) {
				return { type: 'NOTEFLOW_SET', anchors, open };
			},
		},
		selectors: {
			count( state, id ) {
				return ( id && state.anchors[ id ] ) || 0;
			},
			open( state ) {
				return state.open;
			},
		},
	};
	if ( wp.data.createReduxStore && wp.data.register ) {
		wp.data.register( wp.data.createReduxStore( STORE, storeConfig ) );
	} else {
		wp.data.registerStore( STORE, storeConfig );
	}

	/* Blocks ------------------------------------------------------------------------------ */

	const blocks = () => select( 'core/block-editor' );

	function anchorOf( clientId ) {
		const attributes = clientId ? blocks().getBlockAttributes( clientId ) : null;
		return ( attributes && attributes.metadata && attributes.metadata[ KEY ] ) || '';
	}

	function plain( html ) {
		const doc = new window.DOMParser().parseFromString( '<body>' + html + '</body>', 'text/html' );
		return ( doc.body.textContent || '' ).replace( /\s+/g, ' ' ).trim();
	}

	function textOf( block, depth ) {
		const attributes = block.attributes || {};
		for ( const key of [ 'content', 'text', 'value', 'citation', 'caption', 'alt', 'title', 'label' ] ) {
			const value = attributes[ key ];
			let raw = '';
			if ( typeof value === 'string' ) {
				raw = value;
			} else if ( value && typeof value.toHTMLString === 'function' ) {
				raw = value.toHTMLString();
			}
			const text = raw ? plain( raw ) : '';
			if ( text ) {
				return text;
			}
		}
		if ( depth < 3 ) {
			for ( const inner of block.innerBlocks || [] ) {
				const text = textOf( inner, depth + 1 );
				if ( text ) {
					return text;
				}
			}
		}
		return '';
	}

	/**
	 * A block as the panel shows it: its name and the start of its text.
	 *
	 * @param {string} clientId Block.
	 * @return {Object|null} clientId, label and text.
	 */
	function describe( clientId ) {
		const block = clientId ? blocks().getBlock( clientId ) : null;
		if ( ! block ) {
			return null;
		}
		const type = wp.blocks.getBlockType( block.name );
		const custom = block.attributes.metadata && block.attributes.metadata.name;
		let text = textOf( block, 0 );
		if ( text.length > 90 ) {
			text = text.slice( 0, 88 ).trim() + '…';
		}
		return { clientId, label: custom || ( type ? type.title : block.name ), text };
	}

	/**
	 * The block's NoteFlow anchor, adding one if it has none. The anchor is kept in the
	 * block's metadata, so it stays with the block when it moves, once the post is saved.
	 *
	 * @param {string} clientId Block.
	 * @return {string} Anchor, or '' when the block can't hold one.
	 */
	function ensureAnchor( clientId ) {
		const block = clientId ? blocks().getBlock( clientId ) : null;
		const type = block && wp.blocks.getBlockType( block.name );
		if ( ! block || ! type || ! type.attributes || ! type.attributes.metadata ) {
			return '';
		}
		const metadata = block.attributes.metadata || {};
		if ( metadata[ KEY ] ) {
			return metadata[ KEY ];
		}
		const id = 'nf' + Date.now().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 6 );
		dispatch( 'core/block-editor' ).updateBlockAttributes( clientId, { metadata: Object.assign( {}, metadata, { [ KEY ]: id } ) } );
		return id;
	}

	function findAnchor( id, list ) {
		for ( const block of list ) {
			if ( block.attributes && block.attributes.metadata && block.attributes.metadata[ KEY ] === id ) {
				return block.clientId;
			}
			const inner = block.innerBlocks && block.innerBlocks.length ? findAnchor( id, block.innerBlocks ) : '';
			if ( inner ) {
				return inner;
			}
		}
		return '';
	}

	/**
	 * Selects the block a thread is attached to and scrolls to it.
	 *
	 * @param {string}  id   Anchor.
	 * @param {boolean} wait Keep trying for a few seconds, while the editor loads.
	 * @return {boolean} Whether the block was found.
	 */
	function reveal( id, wait ) {
		const clientId = id ? findAnchor( id, blocks().getBlocks() ) : '';
		if ( ! clientId ) {
			if ( wait ) {
				let tries = 0;
				const timer = setInterval( () => {
					if ( reveal( id, false ) || ++tries > 20 ) {
						clearInterval( timer );
					}
				}, 500 );
			}
			return false;
		}
		dispatch( 'core/block-editor' ).selectBlock( clientId );
		const canvas = document.querySelector( 'iframe[name="editor-canvas"]' );
		const doc = canvas && canvas.contentDocument ? canvas.contentDocument : document;
		const node = doc.querySelector( '[data-block="' + clientId + '"]' );
		if ( node ) {
			node.scrollIntoView( { block: 'center' } );
		}
		return true;
	}

	let lastState = '';

	/** What the panel uses to talk to the editor. */
	const bridge = {
		describe,
		anchorOf,
		reveal,
		anchor: ensureAnchor,
		exists: ( clientId ) => !! ( clientId && blocks().getBlock( clientId ) ),
		selectedId: () => blocks().getSelectedBlockClientId(),
		selected: () => describe( blocks().getSelectedBlockClientId() ),
		isDirty: () => select( 'core/editor' ).isEditedPostDirty(),
		onSelect( callback ) {
			let last = blocks().getSelectedBlockClientId();
			return subscribe( () => {
				const now = blocks().getSelectedBlockClientId();
				if ( now !== last ) {
					last = now;
					callback( now );
				}
			} );
		},
		setState( anchors, open ) {
			const next = JSON.stringify( [ anchors, open ] );
			if ( next !== lastState ) {
				lastState = next;
				dispatch( STORE ).set( anchors, open );
			}
		},
	};

	const host = document.createElement( 'div' );
	host.className = 'nfd-host';
	const discussion = new window.NoteFlowDiscussion( host, config, bridge );

	/* Sidebar ----------------------------------------------------------------------------- */

	let pending = null;

	function openSidebar() {
		const editPost = dispatch( 'core/edit-post' );
		if ( editPost && editPost.openGeneralSidebar ) {
			editPost.openGeneralSidebar( 'noteflow/' + SIDEBAR );
		} else if ( dispatch( 'core/interface' ) ) {
			dispatch( 'core/interface' ).enableComplementaryArea( 'core', 'noteflow/' + SIDEBAR );
		}
	}

	/**
	 * Starts a comment on a block, opening the sidebar if it is closed.
	 *
	 * @param {string} clientId Block.
	 */
	function commentOn( clientId ) {
		if ( host.isConnected ) {
			discussion.commentOn( clientId );
		} else {
			pending = clientId;
		}
		openSidebar();
	}

	function Panel() {
		const ref = useRef( null );
		useEffect( () => {
			ref.current.appendChild( host );
			discussion.mounted( pending );
			pending = null;
			return () => host.remove();
		}, [] );
		return el( 'div', { ref, className: 'nfd-sidebar' } );
	}

	const logo = el(
		'svg',
		{ viewBox: '0 0 24 24', width: 24, height: 24, xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true, focusable: false },
		el( 'path', { d: 'M6.5 3.5h11a3 3 0 0 1 3 3v8.2l-5.8 5.8H6.5a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' } ),
		el( 'path', { d: 'M14.7 20.5v-3.8a2 2 0 0 1 2-2h3.8M7.5 8.5h9M7.5 12h6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } )
	);

	const commentIcon = el(
		'svg',
		{ viewBox: '0 0 24 24', width: 24, height: 24, xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true, focusable: false },
		el( 'path', { d: 'M19.5 11.4a7.4 7.4 0 0 1-10.7 6.6L4.5 19.5l1.5-4.2a7.4 7.4 0 1 1 13.5-3.9Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' } ),
		el( 'path', { d: 'M12 8.5v5.5M9.25 11.25h5.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' } )
	);

	function SidebarIcon() {
		const open = useSelect( ( s ) => s( STORE ).open(), [] );
		return el(
			'span',
			{ className: 'nf-sidebar-icon' },
			logo,
			open ? el( 'span', { className: 'nf-sidebar-count', 'aria-hidden': true }, open > 9 ? '9+' : String( open ) ) : null
		);
	}

	function Sidebar() {
		const open = useSelect( ( s ) => s( STORE ).open(), [] );
		const title = open
			? sprintf(
				/* translators: %d: number of open comments and issues. */
				_n( 'NoteFlow: %d open', 'NoteFlow: %d open', open, 'noteflow' ),
				open
			)
			: __( 'NoteFlow', 'noteflow' );
		return el(
			Fragment,
			null,
			PluginSidebarMoreMenuItem ? el( PluginSidebarMoreMenuItem, { target: SIDEBAR, icon: logo }, __( 'NoteFlow', 'noteflow' ) ) : null,
			el( PluginSidebar, { name: SIDEBAR, title, icon: el( SidebarIcon ) }, el( Panel ) )
		);
	}

	wp.plugins.registerPlugin( 'noteflow', { icon: logo, render: Sidebar } );

	/* Block toolbar and highlights --------------------------------------------------------------- */

	function CommentButton( { clientId, anchor } ) {
		const count = useSelect( ( s ) => s( STORE ).count( anchor ), [ anchor ] );
		return el(
			BlockControls,
			{ group: 'other' },
			el( ToolbarButton, {
				icon: commentIcon,
				className: 'nf-toolbar-comment',
				label: count
					? sprintf(
						/* translators: %d: number of open comments and issues on the block. */
						_n( 'Comment (%d open)', 'Comment (%d open)', count, 'noteflow' ),
						count
					)
					: __( 'Comment', 'noteflow' ),
				'data-count': count ? String( count ) : undefined,
				onClick: () => commentOn( clientId ),
			} )
		);
	}

	const withCommentButton = createHigherOrderComponent(
		( BlockEdit ) => ( props ) => {
			if ( ! config.discussions || ! props.isSelected ) {
				return el( BlockEdit, props );
			}
			const anchor = ( props.attributes && props.attributes.metadata && props.attributes.metadata[ KEY ] ) || '';
			return el( Fragment, null, el( BlockEdit, props ), el( CommentButton, { clientId: props.clientId, anchor } ) );
		},
		'withNoteFlowCommentButton'
	);

	const withHighlight = createHigherOrderComponent(
		( BlockListBlock ) => ( props ) => {
			const anchor = ( props.attributes && props.attributes.metadata && props.attributes.metadata[ KEY ] ) || '';
			const count = useSelect( ( s ) => ( anchor ? s( STORE ).count( anchor ) : 0 ), [ anchor ] );
			if ( ! count ) {
				return el( BlockListBlock, props );
			}
			return el( BlockListBlock, Object.assign( {}, props, { className: ( props.className ? props.className + ' ' : '' ) + 'nf-has-discussion' } ) );
		},
		'withNoteFlowHighlight'
	);

	addFilter( 'editor.BlockEdit', 'noteflow/comment-button', withCommentButton );
	addFilter( 'editor.BlockListBlock', 'noteflow/highlight', withHighlight );

	// Opened from a notification or the posts list: show the sidebar.
	if ( config.focus ) {
		wp.domReady( () => setTimeout( openSidebar, 400 ) );
	}
}( window.wp ) );
