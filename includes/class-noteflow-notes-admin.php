<?php
class NoteFlow_Notes_Admin {
    public static function init() {
        add_action('admin_menu', array(__CLASS__, 'add_menu_page'));

        // Register AJAX handlers
        add_action('wp_ajax_get_notes_list', array(__CLASS__, 'get_notes_list'));
        add_action('wp_ajax_get_note', array(__CLASS__, 'get_note'));
        add_action('wp_ajax_save_note', array(__CLASS__, 'save_note'));
        add_action('wp_ajax_delete_note', array(__CLASS__, 'delete_note'));
        add_action('wp_ajax_search_notes', array(__CLASS__, 'search_notes'));
        add_action('wp_ajax_nopriv_search_notes', array(__CLASS__, 'search_notes')); // Optional if you want it to work for non-logged-in users
        
        // Add the new AJAX action for pin status
        add_action('wp_ajax_update_pin_status', array( __CLASS__, 'update_pin_status'));
    }

    public static function add_menu_page() {
        add_menu_page(
            __('NoteFlow', 'noteflow'),
            __('NoteFlow', 'noteflow'),
            'edit_posts',
            'noteflow-notes',
            array(__CLASS__, 'render_notes_page'),
            'dashicons-sticky',
            30
        );
    }

    public static function render_notes_page() {
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('NoteFlow Notes', 'noteflow'); ?></h1>
            <div id="wp-notes-app">
                <div class="wp-notes-sidebar">
                    <div class="wp-notes-search">
                        <input type="text" id="notes-search" placeholder="<?php esc_attr_e('Search notes...', 'noteflow'); ?>">
                    </div>
                    <div class="wp-notes-list">
                        <!-- Notes list will be populated via JavaScript -->
                    </div>
                </div>
                <div class="wp-notes-content">
                    <div class="wp-notes-toolbar">
                        <button class="button button-primary new-note">
                            <?php esc_html_e('New Note', 'noteflow'); ?>
                        </button>
                        <div class="note-controls">
                            <div class="color-picker-wrapper">
                                <input type="text" id="note-color" class="note-color-picker" value="#ffffff">
                            </div>
                            <button type="button" id="pin-note-btn" class="button pin-button" title="<?php esc_attr_e('Pin/Unpin Note', 'noteflow'); ?>">
                                <span class="dashicons dashicons-admin-post"></span>
                            </button>
                        </div>
                    </div>
                    <div class="wp-notes-editor">
                        <!-- TinyMCE editor will be initialized here -->

                        <div class="wp-notes-editor-container">
                            <input type="text" id="note-title" placeholder="<?php esc_attr_e('Note Title', 'noteflow'); ?>">
                            <?php 
                            wp_editor('', 'note-editor', array(
                                'media_buttons' => true,
                                'textarea_rows' => 20,
                                'teeny' => false,
                                'quicktags' => true,
                                'tinymce' => array(
                                    'plugins' => 'lists,link,image,charmap,fullscreen,wordpress,wplink,wpdialogs',
                                    'toolbar1' => 'formatselect,bold,italic,bullist,numlist,link,unlink,undo,redo,fullscreen',
                                    'toolbar2' => '',
                                    'wp_autoresize_on' => true
                                )
                            ));
                            ?>
                            <div class="note-actions">
                                <button class="button button-primary save-note-btn">
                                    <?php esc_html_e('Save Note', 'noteflow'); ?>
                                </button>
                                <button class="button button-link-delete delete-note-btn">
                                    <?php esc_html_e('Delete Note', 'noteflow'); ?>
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
        <?php
    }

    public static function update_pin_status() {
        check_ajax_referer('wp-notes-nonce', 'nonce');
    
        $note_id = isset($_POST['note_id']) ? intval($_POST['note_id']) : 0;
        $is_pinned = isset($_POST['is_pinned']) ? filter_var(wp_unslash($_POST['is_pinned']), FILTER_VALIDATE_BOOLEAN) : false;
    
        if (!$note_id) {
            wp_send_json_error('Invalid note ID');
            return;
        }
    
        // Verify the note exists and belongs to the current user
        $note = get_post($note_id);
        
        // Check if note exists
        if (!is_object($note)) {
            wp_send_json_error(array(
                'message' => 'Note not found',
                'debug' => array(
                    'note_id' => $note_id,
                    'note_type' => gettype($note)
                )
            ));
            return;
        }

        // Check if it's the correct post type
        if (!isset($note->post_type) || $note->post_type !== 'noteflow_notes') {
            wp_send_json_error(array(
                'message' => 'Invalid note type',
                'debug' => array(
                    'note_id' => $note_id,
                    'post_type' => isset($note->post_type) ? $note->post_type : 'undefined'
                )
            ));
            return;
        }

        // Check if the current user owns the note
        if (absint($note->post_author) !== get_current_user_id()) {
            wp_send_json_error(array(
                'message' => 'Access denied',
                'debug' => array(
                    'note_id' => $note_id,
                    'note_author' => absint($note->post_author),
                    'current_user' => get_current_user_id()
                )
            ));
            return;
        }
        
        // Update the pin status
        $result = update_post_meta($note_id, '_note_pinned', $is_pinned);
    
        if ($result !== false) {
            wp_send_json_success(array(
                'message' => $is_pinned ? 'Note pinned successfully' : 'Note unpinned successfully',
                'is_pinned' => $is_pinned
            ));
        } else {
            wp_send_json_error('Failed to update pin status');
        }
    }

    // Add these methods to class WP_Notes_Admin
    public static function get_notes_list() {
        check_ajax_referer('wp-notes-nonce', 'nonce');
    
        $args = array(
            'post_type' => 'noteflow_notes',
            'posts_per_page' => -1,
            'orderby' => 'meta_value date',  // Order by pin status and date
            'order' => 'DESC',               // Descending order
            'meta_key' => '_note_pinned',    // Meta key for sorting
            'meta_type' => 'NUMERIC',        // Treat the meta value as numeric
            'meta_query' => array(
                'relation' => 'OR',
                array(
                    'key' => '_note_pinned',
                    'value' => '1',
                    'type' => 'NUMERIC'
                ),
                array(
                    'key' => '_note_pinned',
                    'value' => '0',
                    'type' => 'NUMERIC'
                ),
                array(
                    'key' => '_note_pinned',
                    'compare' => 'NOT EXISTS'
                )
            )
        );
    
        $notes = get_posts($args);
        $formatted_notes = array();
    
        foreach ($notes as $note) {
            
            $formatted_notes[] = array(
                'ID' => $note->ID,
                'post_title' => $note->post_title,
                'post_content' => wp_strip_all_tags($note->post_content),
                'post_modified' => get_the_modified_date('Y-m-d H:i:s', $note->ID),
                'color' => get_post_meta($note->ID, '_note_color', true) ?: '#ffffff',
                'is_pinned' => (bool)get_post_meta($note->ID, '_note_pinned', true)
            );
        }
    
        if (!empty($formatted_notes)) {
            // Sort notes with pinned ones first
            usort($formatted_notes, function($a, $b) {
                if ($a['is_pinned'] !== $b['is_pinned']) {
                    return $b['is_pinned'] - $a['is_pinned'];
                }
                return strtotime($b['post_modified']) - strtotime($a['post_modified']);
            });
    
            wp_send_json_success($formatted_notes);
        } else {
            wp_send_json_success(array()); // Return empty array if no notes found
        }
    }

    public static function get_note() {
        check_ajax_referer('wp-notes-nonce', 'nonce');
        
        $note_id = isset($_POST['note_id']) ? intval($_POST['note_id']) : 0;
    
        if (!$note_id) {
            wp_send_json_error('Invalid note ID');
            return;
        }

        $note = get_post($note_id);
        
        if (!$note || $note->post_type !== 'noteflow_notes') {
            wp_send_json_error('Note not found');
            return;
        }

        $response = array(
            'ID' => $note->ID,
            'post_title' => $note->post_title,
            'post_content' => $note->post_content,
            'post_modified' => get_the_modified_date('Y-m-d H:i:s', $note->ID),
            'color' => get_post_meta($note->ID, '_note_color', true) ?: '#ffffff',
            'is_pinned' => (bool)get_post_meta($note->ID, '_note_pinned', true)
        );

        wp_send_json_success($response);
    }

    public static function save_note() {
        check_ajax_referer('wp-notes-nonce', 'nonce');
        
        $note_id = isset($_POST['note_id']) ? intval($_POST['note_id']) : 0;
        $title = isset($_POST['title']) ? sanitize_text_field(wp_unslash($_POST['title'])) : '';
        $content = isset($_POST['content']) ? wp_kses_post(wp_unslash($_POST['content'])) : '';

        $color = '#ffffff'; // Default color
        if (isset($_POST['color'])) {
            $color_input = wp_unslash(sanitize_text_field(wp_unslash($_POST['color'])));
            $sanitized_color = sanitize_hex_color($color_input);
            if ($sanitized_color) {
                $color = $sanitized_color;
            }
        }
        $is_pinned = isset($_POST['is_pinned']) ? filter_var(wp_unslash($_POST['is_pinned']), FILTER_VALIDATE_BOOLEAN) : false;
        $status = ($note_id!==0)?'Updated':'Created';

        $note_data = array(
            'post_type' => 'noteflow_notes',
            'post_title' => $title,
            'post_content' => $content,
            'post_status' => 'publish'
        );  

        if ($note_id) {
            update_post_meta($note_id, '_note_color', $color);
            update_post_meta($note_id, '_note_pinned', $is_pinned);

            $note_data['ID'] = $note_id;
            $result = wp_update_post($note_data);
        } else {
            $result = wp_insert_post($note_data);
        }

        if ($result && !is_wp_error($result)) {
            update_post_meta($result, '_note_color', $color);
            update_post_meta($result, '_note_pinned', $is_pinned ? '1' : '0');
    
            wp_send_json_success(array(
                'note_id' => $result,
                'color' => $color,
                'is_pinned' => $is_pinned,
                'status' => $status
            ));
        } else {
            wp_send_json_error('Failed to save note');
        }
    }

    public static function delete_note() {
        check_ajax_referer('wp-notes-nonce', 'nonce');
        
        $note_id = isset($_POST['note_id']) ? intval($_POST['note_id']) : 0;
        
        if (!$note_id) {
            wp_send_json_error('Invalid note ID');
            return;
        }

        $result = wp_delete_post($note_id, true);

        if ($result) {
            wp_send_json_success();
        } else {
            wp_send_json_error('Failed to delete note');
        }
    }

    public static function search_notes() {
        check_ajax_referer('wp-notes-nonce', 'nonce');
    
        $query = isset($_POST['query']) ? sanitize_text_field(wp_unslash($_POST['query'])) : '';
        
        $args = array(
            'post_type' => 'noteflow_notes',
            'posts_per_page' => -1,
            's' => $query, // Search query
            'orderby' => 'date',
            'order' => 'DESC'
        );
    
        $notes = get_posts($args);
        $formatted_notes = array();
    
        foreach ($notes as $note) {
            $formatted_notes[] = array(
                'ID' => $note->ID,
                'post_title' => $note->post_title,
                'post_content' => $note->post_content,
                'post_modified' => get_the_modified_date('Y-m-d H:i:s', $note->ID),
                'color' => get_post_meta($note->ID, '_note_color', true) ?: '#ffffff',
                'is_pinned' => (bool)get_post_meta($note->ID, '_note_pinned', true)
            );
        }
    
        if (!empty($formatted_notes)) {
            wp_send_json_success($formatted_notes);
        } else {
            wp_send_json_error('No notes found.');
        }
    }

    

}