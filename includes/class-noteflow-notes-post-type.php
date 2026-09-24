<?php
class NoteFlow_Notes_Post_Type {
    public static function init() {
        add_action('init', array(__CLASS__, 'register_post_type'));
        add_action('init', array(__CLASS__, 'register_taxonomies'));
    }

    public static function register_post_type() {
        $args = array(
            'public' => false,
            'show_ui' => true,
            'show_in_menu' => false,
            'supports' => array('title', 'editor'),
            'labels' => array(
                'name' => __('Notes', 'noteflow'),
                'singular_name' => __('Note', 'noteflow'),
            ),
            'menu_icon' => 'dashicons-sticky'
        );
        
        register_post_type('noteflow_notes', $args);
    }

    public static function register_taxonomies() {
        $args = array(
            'hierarchical' => true,
            'show_ui' => true,
            'show_admin_column' => true,
            'query_var' => true,
            'labels' => array(
                'name' => __('Note Categories', 'noteflow'),
                'singular_name' => __('Category', 'noteflow')
            )
        );

        register_taxonomy('noteflow_notes_category', 'noteflow_notes', $args);
    }
}