<?php
/**
 * Content notes module.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Attaches notes to posts and pages, and shows them in a Notes box in the editor.
 */
class NoteFlow_Module_Content_Notes {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_meta_box' ), 10, 2 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
	}

	/**
	 * Whether the Notes box belongs on this post type.
	 *
	 * @param string $post_type Post type.
	 * @return bool
	 */
	private static function enabled_for( $post_type ) {
		// With discussions on, the NoteFlow box and sidebar show these notes in a tab.
		return ! NoteFlow_Settings::module_enabled( 'discussions' )
			&& in_array( $post_type, (array) NoteFlow_Settings::get( 'content_post_types' ), true )
			&& NoteFlow_Access::can_use();
	}

	/**
	 * Adds the Notes box.
	 *
	 * @param string  $post_type Post type.
	 * @param WP_Post $post      Post being edited.
	 */
	public static function add_meta_box( $post_type, $post ) {
		if ( ! $post instanceof WP_Post || ! self::enabled_for( $post_type ) ) {
			return;
		}
		add_meta_box( 'noteflow-content-notes', __( 'Notes', 'noteflow' ), array( __CLASS__, 'render' ), $post_type, 'side', 'default' );
	}

	/**
	 * Loads the Notes box script on editing screens.
	 *
	 * @param string $hook Current admin page.
	 */
	public static function enqueue( $hook ) {
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}
		$screen = get_current_screen();
		if ( $screen && self::enabled_for( $screen->post_type ) ) {
			NoteFlow_Admin_Assets::enqueue_quick();
		}
	}

	/**
	 * Notes attached to a post that the user can open.
	 *
	 * @param int $post_id Post ID.
	 * @param int $user_id User ID.
	 * @return WP_Post[]
	 */
	public static function notes_for( $post_id, $user_id ) {
		$ids = NoteFlow_Notes::accessible_ids( $user_id, false );
		if ( ! $ids ) {
			return array();
		}
		return get_posts(
			array(
				'post_type'      => NoteFlow_Notes::POST_TYPE,
				'post_status'    => 'publish',
				'post__in'       => $ids,
				'posts_per_page' => 50,
				'orderby'        => 'modified',
				'meta_key'       => NoteFlow_Notes::LINKED, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => (int) $post_id, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);
	}

	/**
	 * Renders the Notes box.
	 *
	 * @param WP_Post $post Post being edited.
	 */
	public static function render( $post ) {
		$uid   = get_current_user_id();
		$notes = self::notes_for( $post->ID, $uid );
		$type  = get_post_type_object( $post->post_type );
		?>
		<div class="nf-cn" data-post="<?php echo esc_attr( $post->ID ); ?>">
			<ul class="nf-cn-list">
				<?php
				foreach ( $notes as $note ) {
					NoteFlow_Admin_Assets::note_item( NoteFlow_Notes::summary( $note, $uid ) );
				}
				?>
			</ul>
			<p class="nf-cn-empty" <?php echo $notes ? 'hidden' : ''; ?>>
				<?php
				/* translators: %s: post type name, like "post" or "page". */
				echo esc_html( sprintf( __( 'No notes on this %s yet. Notes you add here are private until you share them.', 'noteflow' ), $type ? strtolower( $type->labels->singular_name ) : __( 'item', 'noteflow' ) ) );
				?>
			</p>
			<div class="nf-cn-form">
				<label class="screen-reader-text" for="nf-cn-text"><?php esc_html_e( 'New note', 'noteflow' ); ?></label>
				<textarea id="nf-cn-text" rows="3" placeholder="<?php esc_attr_e( 'Add a note…', 'noteflow' ); ?>"></textarea>
				<div class="nf-cn-actions">
					<button type="button" class="button nf-cn-save"><?php esc_html_e( 'Add note', 'noteflow' ); ?></button>
					<span class="nf-cn-status" role="status"></span>
				</div>
			</div>
		</div>
		<?php
	}
}
