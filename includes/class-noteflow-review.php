<?php
/**
 * Asking for a review on WordPress.org.
 *
 * @package NoteFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Asks people who use NoteFlow for a review, once they have used it for a few days:
 * in the notes app for everyone, and in a notice on the Dashboard and Plugins screens
 * for administrators. "Maybe later" asks again in two weeks; leaving a review or
 * "I already did" stops it for good. The Plugins screen and the Settings footer carry
 * a quiet rating link all the time.
 */
class NoteFlow_Review {

	const USER_KEY    = 'noteflow_review';
	const URL         = 'https://wordpress.org/support/plugin/noteflow/reviews/#new-post';
	const MIN_NOTES   = 3;
	const MIN_DAYS    = 3;
	const SNOOZE_DAYS = 14;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_notices', array( __CLASS__, 'notice' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_filter( 'plugin_row_meta', array( __CLASS__, 'row_meta' ), 10, 2 );
		add_filter( 'admin_footer_text', array( __CLASS__, 'footer_text' ) );
	}

	/**
	 * How many notes the user owns, and when the oldest was written.
	 *
	 * @param int $user_id User ID.
	 * @return array{0:int,1:int} Count and Unix time.
	 */
	private static function usage( $user_id ) {
		global $wpdb;
		$row = $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				"SELECT COUNT(*) AS notes, MIN(post_date_gmt) AS oldest FROM {$wpdb->posts} WHERE post_type = %s AND post_author = %d AND post_status = 'publish'",
				NoteFlow_Post_Type::NAME,
				(int) $user_id
			)
		);
		return array( $row ? (int) $row->notes : 0, $row && $row->oldest ? (int) strtotime( $row->oldest . ' +0000' ) : 0 );
	}

	/**
	 * Whether to ask this person now: they own a few notes, have used NoteFlow for a
	 * few days, and haven't reviewed, said they did, or asked us to wait.
	 *
	 * @param int $user_id User ID.
	 * @return bool
	 */
	public static function should_ask( $user_id ) {
		$state = get_user_option( self::USER_KEY, $user_id );
		if ( 'done' === $state || ( $state && time() - (int) $state < self::SNOOZE_DAYS * DAY_IN_SECONDS ) ) {
			return false;
		}

		list( $notes, $oldest ) = self::usage( $user_id );
		if ( $notes < self::MIN_NOTES ) {
			return false;
		}

		$since = $oldest;
		$first = (int) get_user_option( 'noteflow_welcomed', $user_id );
		if ( $first && ( ! $since || $first < $since ) ) {
			$since = $first;
		}

		/**
		 * Filters whether NoteFlow asks this person for a review now.
		 *
		 * @param bool $ask     Whether to ask.
		 * @param int  $user_id User ID.
		 */
		return (bool) apply_filters( 'noteflow_ask_for_review', $since && time() - $since >= self::MIN_DAYS * DAY_IN_SECONDS, $user_id );
	}

	/**
	 * Remembers the answer: 'later' asks again in two weeks, anything else never.
	 *
	 * @param int    $user_id User ID.
	 * @param string $answer  'later' or 'done'.
	 */
	public static function answer( $user_id, $answer ) {
		update_user_option( $user_id, self::USER_KEY, 'later' === $answer ? time() : 'done' );
	}

	/**
	 * Whether the notice belongs on this screen, for this person.
	 *
	 * @return bool
	 */
	private static function notice_here() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		return $screen
			&& in_array( $screen->id, array( 'dashboard', 'plugins' ), true )
			&& current_user_can( 'manage_options' )
			&& NoteFlow_Access::can_use()
			&& self::should_ask( get_current_user_id() );
	}

	/**
	 * Styles and the small script that records the answer.
	 */
	public static function enqueue() {
		if ( ! self::notice_here() ) {
			return;
		}

		wp_register_style( 'noteflow-review', false, array(), NOTEFLOW_VERSION );
		wp_enqueue_style( 'noteflow-review' );
		wp_add_inline_style(
			'noteflow-review',
			'.nf-review-notice{display:flex;gap:14px;align-items:flex-start;padding:14px 38px 14px 14px;border-left-color:#f5a300}' .
			'.nf-review-notice img{flex:none;border-radius:10px}' .
			'.nf-review-notice p{margin:0 0 10px;font-size:13.5px}' .
			'.nf-review-notice .nf-stars{color:#f5a300;letter-spacing:1px}' .
			'.nf-review-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0!important}'
		);

		wp_enqueue_script( 'wp-api-fetch' );
		wp_add_inline_script(
			'wp-api-fetch',
			'document.addEventListener("click",function(e){var el=e.target.closest(".nf-review-notice [data-nf-review],.nf-review-notice .notice-dismiss");if(!el){return;}var notice=el.closest(".nf-review-notice");var later=el.classList.contains("notice-dismiss")||"later"===el.getAttribute("data-nf-review");wp.apiFetch({path:"/noteflow/v1/dismiss",method:"POST",data:{what:"review",later:later?1:0}}).catch(function(){});if("A"!==el.tagName){e.preventDefault();notice.remove();}else{setTimeout(function(){notice.remove();},300);}});'
		);
	}

	/**
	 * The review notice on the Dashboard and Plugins screens.
	 */
	public static function notice() {
		if ( ! self::notice_here() ) {
			return;
		}
		list( $notes ) = self::usage( get_current_user_id() );
		?>
		<div class="notice notice-info is-dismissible nf-review-notice">
			<img src="<?php echo esc_url( NOTEFLOW_URL . 'assets/images/noteflow-icon.svg' ); ?>" width="44" height="44" alt="">
			<div>
				<p>
					<strong><?php esc_html_e( 'Enjoying NoteFlow?', 'noteflow' ); ?></strong>
					<?php
					/* translators: %s: number of notes. */
					echo esc_html( sprintf( _n( 'You have written %s note with it.', 'You have written %s notes with it.', $notes, 'noteflow' ), number_format_i18n( $notes ) ) );
					?>
					<?php esc_html_e( 'A quick review on WordPress.org takes a minute and helps other teams find NoteFlow.', 'noteflow' ); ?>
				</p>
				<p class="nf-review-actions">
					<a class="button button-primary" href="<?php echo esc_url( self::URL ); ?>" target="_blank" rel="noopener noreferrer" data-nf-review="done">
						<span class="nf-stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
						<?php esc_html_e( 'Leave a review', 'noteflow' ); ?>
						<span class="screen-reader-text"><?php esc_html_e( '(opens in a new tab)', 'noteflow' ); ?></span>
					</a>
					<button type="button" class="button" data-nf-review="later"><?php esc_html_e( 'Maybe later', 'noteflow' ); ?></button>
					<button type="button" class="button-link" data-nf-review="done"><?php esc_html_e( 'I already did', 'noteflow' ); ?></button>
				</p>
			</div>
		</div>
		<?php
	}

	/**
	 * A rating link in NoteFlow's row on the Plugins screen.
	 *
	 * @param string[] $links Links under the description.
	 * @param string   $file  Plugin file.
	 * @return string[]
	 */
	public static function row_meta( $links, $file ) {
		if ( plugin_basename( NOTEFLOW_FILE ) === $file ) {
			$links[] = '<a href="' . esc_url( self::URL ) . '" target="_blank" rel="noopener noreferrer">' . esc_html__( 'Rate NoteFlow', 'noteflow' ) . ' <span aria-hidden="true" style="color:#f5a300">&#9733;&#9733;&#9733;&#9733;&#9733;</span><span class="screen-reader-text"> ' . esc_html__( '(opens in a new tab)', 'noteflow' ) . '</span></a>';
		}
		return $links;
	}

	/**
	 * A thank-you line with a rating link at the bottom of NoteFlow → Settings.
	 *
	 * @param string $text Footer text.
	 * @return string
	 */
	public static function footer_text( $text ) {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'noteflow_page_' . NoteFlow_Settings::PAGE !== $screen->id ) {
			return $text;
		}
		return sprintf(
			/* translators: %s: five-star rating link. */
			esc_html__( 'If NoteFlow helps your team, please rate it %s on WordPress.org. Thank you!', 'noteflow' ),
			'<a href="' . esc_url( self::URL ) . '" target="_blank" rel="noopener noreferrer" style="color:#f5a300;text-decoration:none">&#9733;&#9733;&#9733;&#9733;&#9733;<span class="screen-reader-text"> ' . esc_html__( '(opens in a new tab)', 'noteflow' ) . '</span></a>'
		);
	}
}
