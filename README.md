# FrameX Application

An interactive drawing application built with Konva.js that allows users to create and manipulate shapes and SVG icons.

## Features

- Draw various shapes (circles, rectangles, squares, triangles, lines, stars)
- Add and manipulate SVG icons
- Customize shape properties (colors, stroke width, naming)
- Save and load drawings
- Responsive design
- Modern UI with Bootstrap 5

## Project Structure

```
src/
├── assets/
│   ├── icons/     # UI icons
│   ├── images/    # Background images
│   └── svgs/      # SVG icons for drawing
├── css/
│   └── style.css  # Application styles
├── js/
│   ├── components/
│   │   ├── CanvasManager.js    # Manages the canvas and shapes
│   │   ├── PropertyManager.js  # Handles shape properties
│   │   ├── ShapeManager.js     # Manages shape creation
│   │   └── SVGManager.js       # Manages SVG icons
│   ├── utils/
│   │   └── EventBus.js         # Event handling system
│   └── main.js                 # Application entry point
└── index.html                  # Main HTML file
```

## Getting Started

### Using Docker (Recommended)

1. Make sure you have Docker and Docker Compose installed on your system.

2. Start the development server:

   ```bash
   docker-compose up
   ```

3. Access the application at http://localhost:5173

### Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm start
   ```

3. Build for production:
   ```bash
   npm run build
   ```

## Development

The project uses:

- Vite for building and development
- Konva.js for canvas manipulation
- Bootstrap 5 for UI components
- ES6 modules for code organization
- Docker for containerized development

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

# Future enhancements

This tool—a web-based, interactive drawing and diagramming application with auto-save, SVG/icon support, and shape manipulation—will be useful for a variety of users, including:

1. Engineers & Technical Professionals
   Use Case: Creating process diagrams, flowcharts, system layouts, and technical illustrations.
   Why: The ability to add, connect, and label shapes and SVGs (e.g., machinery, factory icons) is ideal for visualizing workflows, manufacturing processes, or system designs.
2. Educators & Students
   Use Case: Drawing diagrams for teaching, learning, or assignments (e.g., physics setups, biology cycles, math shapes).
   Why: The intuitive interface, auto-save, and easy manipulation make it accessible for classroom or homework use.
3. Product Designers & UX/UI Designers
   Use Case: Sketching wireframes, UI flows, or quick prototypes.
   Why: The drag-and-drop, resize, and rotate features allow for rapid ideation and iteration.
4. Project Managers & Business Analysts
   Use Case: Creating business process diagrams, organizational charts, or workflow visualizations.
   Why: The tool's simplicity and auto-save make it easy to use during meetings or brainstorming sessions.
5. Makers & Hobbyists
   Use Case: Planning DIY projects, layouts for workshops, or hobby circuits.
   Why: The ability to use custom SVGs and basic shapes is helpful for visual planning.
6. Anyone Needing Quick Visual Notes
   Use Case: Whiteboarding, mind mapping, or jotting down visual ideas.
   Why: No login or install required, and work is auto-saved for later.

Key Features That Make It Useful:

- No account or installation required: Works in the browser.
- Auto-save and auto-load: Never lose your work.
- Shape and SVG support: Flexible for many diagram types.
- Resize, rotate, and move: Easy manipulation for precise layouts.
- Clear Canvas: Start fresh anytime.
- Visual feedback: Reassures users their work is saved.

If you want to tailor the tool for a specific audience (e.g., add more industry-specific SVGs, or export to PDF for teachers), let me know!
