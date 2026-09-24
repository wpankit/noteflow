(function($) {
    'use strict';

    let currentNoteId = null;
    let editor = null;

    // Wait for DOM to be ready
    $(document).ready(function() {
        // Check if we're on the notes page
        if ($('#wp-notes-app').length) {
            setTimeout(function(){
                initializeEditor();
                console.log('Initialized');
            },1000);
        }
    });

    function initializeEditor() {
        // Try to get the editor instance
        if (typeof window.tinyMCE !== 'undefined' && window.tinyMCE.get('note-editor')) {
            editor = window.tinyMCE.get('note-editor');
            initializeApp();
        } else {
            // If editor isn't ready, wait a bit and try again
            setTimeout(initializeEditor, 100);
        }
    }

    function initializeApp() {

        // Initialize color picker
        initializeColorPicker();

        // Event Listeners
        $('.new-note').on('click', handleNewNote);
        $('.save-note-btn').on('click', handleSaveNote);
        $('.delete-note-btn').on('click', handleDeleteNote);
        $('#notes-search').on('input', debounce(handleSearch, 500));
        $('.pin-button').on('click', handlePinToggle);

        // Attach the search handler with debounce
        $('#notes-search').on('input', debounce(handleSearch, 300));

        // Load initial notes
        loadNotesList();

        // Add change listener to editor
        if (editor) {
            editor.on('change', function() {
                $('.save-note-btn').show();
            });
        }

        console.log('App initialized with editor:', editor);
    }

    function initializeColorPicker() {
        $('.note-color-picker').wpColorPicker({
            defaultColor: '#ffffff',
            change: function(event, ui) {
                $('.save-note-btn').show();
                updateNotePreview();
            },
            clear: function() {
                $('.save-note-btn').show();
                updateNotePreview();
            }
        });
    }

    // Get Editor Content
    function getEditorContent() {
        if (editor && !editor.isHidden()) {
            return editor.getContent();
        }
        return $('#note-editor').val();
    }

    // Set Editor Content
    function setEditorContent(content) {
        if (editor && !editor.isHidden()) {
            editor.setContent(content || '');
        } else {
            $('#note-editor').val(content || '');
        }
    }

    function handlePinToggle(e) {
        e.preventDefault();
        const $pinButton = $('#pin-note-btn');
        $pinButton.toggleClass('pinned');
        
        // If we have a current note, save the pin status immediately
        if (currentNoteId) {
            updatePinStatus(currentNoteId, $pinButton.hasClass('pinned'));
        } else {
            // Show save button if this is a new note
            $('.save-note-btn').show();
        }
    }

    // Add this new function to handle pin status updates
    function updatePinStatus(noteId, isPinned) {
        $.ajax({
            url: wpNotesObj.ajaxurl,
            type: 'POST',
            data: {
                action: 'update_pin_status',
                nonce: wpNotesObj.nonce,
                note_id: noteId,
                is_pinned: isPinned
            },
            success: function(response) {
                if (response.success) {
                    loadNotesList(); // Refresh the notes list to show updated order
                    showNotification(isPinned ? 'Note pinned' : 'Note unpinned', 'success');
                } else {
                    showNotification('Error updating pin status', 'error');
                    // Revert the pin button state if there was an error
                    $('#pin-note-btn').toggleClass('pinned');
                }
            },
            error: function() {
                showNotification('Error updating pin status', 'error');
                // Revert the pin button state if there was an error
                $('#pin-note-btn').toggleClass('pinned');
            }
        });
    }

    function updateNotePreview() {
        const color = $('#note-color').val() || '#ffffff';
        const isPinned = $('.pin-note-btn').hasClass('pinned');
        
        // Update the current note in the list if it exists
        if (currentNoteId) {
            const noteItem = $(`.note-item[data-id="${currentNoteId}"]`);
            noteItem.css('--note-color', color);
            noteItem.toggleClass('pinned', isPinned);
        }
    }

    // Load Notes List
    function loadNotesList() {
        $.ajax({
            url: wpNotesObj.ajaxurl,
            type: 'POST',
            data: {
                action: 'get_notes_list',
                nonce: wpNotesObj.nonce
            },
            success: function(response) {
                if (response.success) {
                    renderNotesList(response.data);
                }
            }
        });
    }

    // Render Notes List
    function renderNotesList(notes, searchQuery = '') {
        const notesList = $('.wp-notes-list');
        notesList.empty();
    
        if (!notes.length) {
            notesList.append('<div class="no-notes">No notes found</div>');
            return;
        }
    
        // Sort notes: pinned first, then by date
        notes.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) {
                return b.is_pinned - a.is_pinned;
            }
            return new Date(b.post_modified) - new Date(a.post_modified);
        });
    
        notes.forEach(function(note) {
            const noteElement = $(`
                <div class="note-item ${note.is_pinned ? 'pinned' : ''}" 
                     data-id="${note.ID}" 
                     style="background-color: ${note.color}">
                    <h3>${highlightSearchTerm(note.post_title || 'Untitled Note', searchQuery)}</h3>
                    <p class="note-date">${note.post_modified || ''}</p>
                </div>
            `);
    
            noteElement.on('click', function() {
                loadNote(note.ID);
            });
    
            notesList.append(noteElement);
        });
    }

    function highlightSearchTerm(text, term) {
        if (!term) return text;
        const regex = new RegExp(`(${term})`, 'gi');
        return text.replace(regex, '<span class="highlight">\$1</span>');
    }
    
    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    // Update the loadNote function to properly set pin status
    function loadNote(noteId) {
        $.ajax({
            url: wpNotesObj.ajaxurl,
            type: 'POST',
            data: {
                action: 'get_note',
                nonce: wpNotesObj.nonce,
                note_id: noteId
            },
            success: function(response) {
                if (response.success) {
                    displayNote(response.data);
                }
            }
        });
    }

    // Display Note
    function displayNote(note) {
        currentNoteId = note.ID;
        $('#note-title').val(note.post_title);
        setEditorContent(note.post_content);
        $('#note-color').wpColorPicker('color', note.color || '#ffffff');
        
        // Update pin button state
        const $pinButton = $('#pin-note-btn');
        $pinButton.toggleClass('pinned', note.is_pinned === true);
        
        $('.save-note-btn, .delete-note-btn').show();
    }

    // Handle New Note
    function handleNewNote() {
        currentNoteId = null;
        $('#note-title').val('');
        setEditorContent('');
        $('#note-color').wpColorPicker('color', '#ffffff');
        $('.pin-note-btn').removeClass('pinned');
        $('.save-note-btn, .delete-note-btn').hide();
        updateNotePreview();
    }

    // Handle Save Note
    function handleSaveNote() {
        const title = $('#note-title').val();
        const content = getEditorContent();
        const color = $('#note-color').val() || '#ffffff';
        const isPinned = $('.pin-note-btn').hasClass('pinned');

        if (!title) {
            alert('Please enter a title for your note.');
            return;
        }

        $.ajax({
            url: wpNotesObj.ajaxurl,
            type: 'POST',
            data: {
                action: 'save_note',
                nonce: wpNotesObj.nonce,
                note_id: currentNoteId,
                title: title,
                content: content,
                color: color,
                is_pinned: isPinned
            },
            success: function(response) {
                if (response.success) {
                    currentNoteId = response.data.note_id;
                    loadNotesList();
                    $('.save-note-btn').hide();
                    showNotification('Note '+response.data.status+' successfully!');
                }
            }
        });
    }

    // Handle Delete Note
    function handleDeleteNote() {
        if (!currentNoteId) return;

        if (confirm('Are you sure you want to delete this note?')) {
            $.ajax({
                url: wpNotesObj.ajaxurl,
                type: 'POST',
                data: {
                    action: 'delete_note',
                    nonce: wpNotesObj.nonce,
                    note_id: currentNoteId
                },
                success: function(response) {
                    if (response.success) {
                        handleNewNote();
                        loadNotesList();
                        showNotification('Note deleted successfully!');
                    }
                },
                error: function() {
                    showNotification('Error deleting note!', 'error');
                }
            });
        }
    }

    // Handle Search
    function handleSearch() {
        const searchQuery = $('#notes-search').val().toLowerCase();
    
        // Send an AJAX request to filter notes
        $.ajax({
            url: wpNotesObj.ajaxurl,
            type: 'POST',
            data: {
                action: 'search_notes',
                nonce: wpNotesObj.nonce,
                query: searchQuery
            },
            success: function(response) {
                if (response.success) {
                    renderNotesList(response.data, searchQuery);
                } else {
                    showNotification('No notes found.', 'error');
                }
            },
            error: function() {
                showNotification('Error searching notes!', 'error');
            }
        });
    }

    // Debounce function to limit the number of AJAX requests
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // Utility Functions
    function showNotification(message, type = 'success') {
        const $notification = $('<div>', {
            class: `notice notice-${type} is-dismissible`,
            css: {
                position: 'fixed',
                top: '32px',
                right: '20px',
                zIndex: 9999
            }
        }).append($('<p>').text(message));
    
        $('body').append($notification);
    
        setTimeout(() => {
            $notification.fadeOut(() => {
                $notification.remove();
            });
        }, 3000);
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
})(jQuery);