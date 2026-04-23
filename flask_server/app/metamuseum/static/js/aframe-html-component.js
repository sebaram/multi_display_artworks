/* aframe-html-component - stub providing the 'html' component for A-Frame Webpage elements */
(function() {
  'use strict';

  /**
   * html component for A-Frame
   * Usage: <a-entity html="html: #content; aspect: 1.77"></a-entity>
   * Renders an HTML div onto an A-Frame plane using CSS transforms.
   * This is a minimal stub — real project uses iframes for webpage embedding.
   */
  AFRAME.registerComponent('html', {
    schema: {
      type: 'string'
    },
    init: function() {
      // Minimal stub — webpage elements use iframe approach instead
      // This component exists for compatibility but real Webpage rendering
      // is handled by the iframe in the page HTML
    }
  });
})();
