// get the ninja-keys element
const ninja = document.querySelector('ninja-keys');

// add the home and posts menu items
ninja.data = [{
    id: "nav-about",
    title: "about",
    section: "Navigation",
    handler: () => {
      window.location.href = "/portfolio/";
    },
  },{id: "nav-publications",
          title: "publications",
          description: "",
          section: "Navigation",
          handler: () => {
            window.location.href = "/portfolio/publications/";
          },
        },{id: "nav-projects",
          title: "projects",
          description: "Expand each category to view my projects.",
          section: "Navigation",
          handler: () => {
            window.location.href = "/portfolio/projects/";
          },
        },{id: "nav-cv",
          title: "cv",
          description: "",
          section: "Navigation",
          handler: () => {
            window.location.href = "/portfolio/cv/";
          },
        },{id: "post-a-post-with-image-galleries",
      
        title: "a post with image galleries",
      
      description: "this is what included image galleries could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/photo-gallery/";
        
      },
    },{id: "post-a-post-with-tabs",
      
        title: "a post with tabs",
      
      description: "this is what included tabs in a post could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/tabs/";
        
      },
    },{id: "post-a-post-with-typograms",
      
        title: "a post with typograms",
      
      description: "this is what included typograms code could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/typograms/";
        
      },
    },{id: "post-a-post-that-can-be-cited",
      
        title: "a post that can be cited",
      
      description: "this is what a post that can be cited looks like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/post-citation/";
        
      },
    },{id: "post-a-post-with-pseudo-code",
      
        title: "a post with pseudo code",
      
      description: "this is what included pseudo code could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/pseudocode/";
        
      },
    },{id: "post-a-post-with-code-diff",
      
        title: "a post with code diff",
      
      description: "this is how you can display code diffs",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/code-diff/";
        
      },
    },{id: "post-a-post-with-advanced-image-components",
      
        title: "a post with advanced image components",
      
      description: "this is what advanced image components could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/advanced-images/";
        
      },
    },{id: "post-a-post-with-vega-lite",
      
        title: "a post with vega lite",
      
      description: "this is what included vega lite code could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/vega-lite/";
        
      },
    },{id: "post-a-post-with-geojson",
      
        title: "a post with geojson",
      
      description: "this is what included geojson code could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/geojson-map/";
        
      },
    },{id: "post-a-post-with-echarts",
      
        title: "a post with echarts",
      
      description: "this is what included echarts code could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/echarts/";
        
      },
    },{id: "post-a-post-with-chart-js",
      
        title: "a post with chart.js",
      
      description: "this is what included chart.js code could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2024/chartjs/";
        
      },
    },{id: "post-a-post-with-tikzjax",
      
        title: "a post with TikZJax",
      
      description: "this is what included TikZ code could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2023/tikzjax/";
        
      },
    },{id: "post-a-post-with-bibliography",
      
        title: "a post with bibliography",
      
      description: "an example of a blog post with bibliography",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2023/post-bibliography/";
        
      },
    },{id: "post-a-post-with-jupyter-notebook",
      
        title: "a post with jupyter notebook",
      
      description: "an example of a blog post with jupyter notebook",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2023/jupyter-notebook/";
        
      },
    },{id: "post-a-post-with-custom-blockquotes",
      
        title: "a post with custom blockquotes",
      
      description: "an example of a blog post with custom blockquotes",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2023/custom-blockquotes/";
        
      },
    },{id: "post-a-post-with-table-of-contents-on-a-sidebar",
      
        title: "a post with table of contents on a sidebar",
      
      description: "an example of a blog post with table of contents on a sidebar",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2023/sidebar-table-of-contents/";
        
      },
    },{id: "post-a-post-with-audios",
      
        title: "a post with audios",
      
      description: "this is what included audios could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2023/audios/";
        
      },
    },{id: "post-a-post-with-videos",
      
        title: "a post with videos",
      
      description: "this is what included videos could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2023/videos/";
        
      },
    },{id: "post-displaying-beautiful-tables-with-bootstrap-tables",
      
        title: "displaying beautiful tables with Bootstrap Tables",
      
      description: "an example of how to use Bootstrap Tables",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2023/tables/";
        
      },
    },{id: "post-a-post-with-table-of-contents",
      
        title: "a post with table of contents",
      
      description: "an example of a blog post with table of contents",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2023/table-of-contents/";
        
      },
    },{id: "post-a-post-with-giscus-comments",
      
        title: "a post with giscus comments",
      
      description: "an example of a blog post with giscus comments",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2022/giscus-comments/";
        
      },
    },{id: "post-a-post-with-redirect",
      
        title: "a post with redirect",
      
      description: "you can also redirect to assets like pdf",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/assets/pdf/example_pdf.pdf";
        
      },
    },{id: "post-a-post-with-diagrams",
      
        title: "a post with diagrams",
      
      description: "an example of a blog post with diagrams",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2021/diagrams/";
        
      },
    },{id: "post-a-distill-style-blog-post",
      
        title: "a distill-style blog post",
      
      description: "an example of a distill-style blog post and main elements",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2021/distill/";
        
      },
    },{id: "post-a-post-with-twitter",
      
        title: "a post with twitter",
      
      description: "an example of a blog post with twitter",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2020/twitter/";
        
      },
    },{id: "post-a-post-with-disqus-comments",
      
        title: "a post with disqus comments",
      
      description: "an example of a blog post with disqus comments",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2015/disqus-comments/";
        
      },
    },{id: "post-a-post-with-math",
      
        title: "a post with math",
      
      description: "an example of a blog post with some math",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2015/math/";
        
      },
    },{id: "post-a-post-with-code",
      
        title: "a post with code",
      
      description: "an example of a blog post with some code",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2015/code/";
        
      },
    },{id: "post-a-post-with-images",
      
        title: "a post with images",
      
      description: "this is what included images could look like",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2015/images/";
        
      },
    },{id: "post-a-post-with-formatting-and-links",
      
        title: "a post with formatting and links",
      
      description: "march &amp; april, looking forward to summer",
      section: "Posts",
      handler: () => {
        
          window.location.href = "/portfolio/blog/2015/formatting-and-links/";
        
      },
    },{id: "news-a-simple-inline-announcement",
          title: 'A simple inline announcement.',
          description: "",
          section: "News",},{id: "projects-adachat",
          title: 'AdaChat',
          description: "Messaging app for peers using a single remote server. Can also send files.  Python C++",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/adachat/";
            },},{id: "projects-autoperft",
          title: 'autoperft',
          description: "Automatic perft checker for UCI chess engines.  Python",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/auto-perft/";
            },},{id: "projects-barcode-decoding",
          title: 'Barcode Decoding',
          description: "Developed a CNN to detect barcodes in images, pre-process skewed barcodes, and decode them.  PyTorch OpenCV",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/barcode-decoding/";
            },},{id: "projects-bash-like-shell",
          title: 'Bash-like shell',
          description: "A shell for Linux with ANSI colors, used POSIX syscalls for spawning/managing new processes. Background execution, piping, and redirection, wrote ls, discover commands from scratch.  C",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/bash-like-shell/";
            },},{id: "projects-blow-flute",
          title: 'Blow Flute',
          description: "Play flute on phone by blowing into the microphone.  JavaScript Web Audio API",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/blow-flute/";
            },},{id: "projects-campitch",
          title: 'CamPitch',
          description: "Play music with your finger using your webcam.  JavaScript MediaPipe Web Audio API",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/campitch/";
            },},{id: "projects-cars",
          title: 'Cars',
          description: "3D game with AI car opponents, audience, 3 camera views. Wrote collision detection and physics.  JavaScript Three.js",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/cars/";
            },},{id: "projects-chess-analysis",
          title: 'Chess Analysis',
          description: "Allows users to upload their chess games and analyze them using the Stockfish chess engine. The user can also play with the engine.  JavaScript Chess.js Chessboard.js Stockfish",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/chess-analysis/";
            },},{id: "projects-chess-engine",
          title: 'Chess Engine',
          description: "Developed from scratch, uses α-β pruning, late-move reduction. GUI. Used OOPs.  C++ GTK",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/chess-engine/";
            },},{id: "projects-composer",
          title: 'Composer',
          description: "N-gram based composer that composes in a particular raga. It generates the model using existing compositions in the raga.  JavaScript ABCjs",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/composer/";
            },},{id: "projects-cyberchat",
          title: 'CyberChat',
          description: "A chatbot designed to answer queries regarding cybersecurity.  HTML CSS JavaScript",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/cyberchat/";
            },},{id: "projects-demoss",
          title: 'DeMOSS',
          description: "Used Tree-sitter to parse the source code and suggest refactorings to evade MOSS.  HTML CSS JavaScript",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/demoss/";
            },},{id: "projects-enhancing-xv6",
          title: 'Enhancing xv6',
          description: "Implemented and analyzed scheduling policies-- FCFS, Round Robin, PBS, and MLFQ. Wrote new system calls in C (strace, sigalarm, sigreturn). Implemented Copy-on-Write fork for xv6 operating system.  C",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/enhancing-xv6/";
            },},{id: "projects-etymology",
          title: 'Etymology',
          description: "Show word etymology tree. Uses wiktionary data.  JavaScript Cytoscape.js Python",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/etymology/";
            },},{id: "projects-game-of-life",
          title: 'Game of Life',
          description: "This is a simple implementation of Conway&#39;s Game of Life in JavaScript using canvas to render the cells.  JavaScript",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/game-of-life/";
            },},{id: "projects-jetpack-joyride-clone",
          title: 'Jetpack Joyride Clone',
          description: "Made as part of Computer Graphics Assignment 1  C++ OpenGL GLSL",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/jetpack-joyride-clone/";
            },},{id: "projects-kbc-game",
          title: 'KBC Game',
          description: "Kaun Banega Crorepati style quiz game with full-fledged GUI and sound effects, used MySQL for database.  Python SQL GUI",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/kbc-game/";
            },},{id: "projects-library-sort-implementation-and-analysis",
          title: 'Library Sort Implementation and Analysis',
          description: "Library sort is a modification of insertion sort that gains speed by trading space. As part of Introduction to Algorithms Engineering course.  C++ Python",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/library-sort/";
            },},{id: "projects-loss-landscape-visualization",
          title: 'Loss Landscape Visualization',
          description: "Explored neural network loss functions and the impact of model architecture and training parameters on generalization in VGG and ResNet.  PyTorch",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/loss-landscape-visualization/";
            },},{id: "projects-markov-bot",
          title: 'Markov Bot',
          description: "A chatbot that uses Markov chains trained on WhatsApp chat logs to generate responses. Used Flask to serve the web interface.  Python Flask",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/markov-bot/";
            },},{id: "projects-meme-lang",
          title: 'meme lang',
          description: "Meme-lang is a programming language that compiles to javascript. It runs in browser.  JavaScript",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/meme-lang/";
            },},{id: "projects-mess-menu-helper",
          title: 'Mess Menu Helper',
          description: "A searchable web-version of the mess menu.  HTML CSS JavaScript",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/mess-menu-helper/";
            },},{id: "projects-n-gonal-prism-and-pyramid-visualizer",
          title: 'n-gonal prism and pyramid visualizer',
          description: "Made as part of Computer Graphics Assignment 0  C++ OpenGL GLSL",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/prism-pyramid-visualizer/";
            },},{id: "projects-raag-identifier",
          title: 'Raag Identifier',
          description: "Identifies notes from live audio using FFT. Uses a database of 100+ Raags and identifies the Raag.  Android B4A",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/raag-identifier/";
            },},{id: "projects-raga-cover-blitz",
          title: 'Raga Cover Blitz',
          description: "A two-player game to test raga knowledge.  JavaScript",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/raga-cover-blitz/";
            },},{id: "projects-ragaspace",
          title: 'Ragaspace',
          description: "Shows both Hindustani and Carnatic ragas in 2d raga space. Similar ragas are closer. Can enter a new phrase and see the closest raga it matches to in the graph.  JavaScript D3.js",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/ragaspace/";
            },},{id: "projects-reddit-clone",
          title: 'Reddit Clone',
          description: "Full-stack (MERN) social media website with user profiles, posts, flagging, analytics. Docker-containerized.  MongoDB Express React Node.js",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/reddit-clone/";
            },},{id: "projects-rubik-39-s-cube",
          title: 'Rubik&amp;#39;s Cube',
          description: "A Rubik&#39;s Cube simulator written from scratch. With solving algorithm.  JavaScript ThreeJS",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/rubiks-cube/";
            },},{id: "projects-scroll-till-the-end",
          title: 'Scroll till the End',
          description: "A simple game to demonstrate Flutter and the live update of high-scores using Firebase.  Android Flutter Firebase",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/scroll-till-the-end/";
            },},{id: "projects-shruti",
          title: 'Shruti',
          description: "Sing along with a vocal track, observe and correct your pitch visually.  JavaScript Web Audio API",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/shruti/";
            },},{id: "projects-snake",
          title: 'Snake',
          description: "Snake game with powerups, high scores, and menus.  C++ ncurses",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/snake/";
            },},{id: "projects-surfers",
          title: 'Surfers',
          description: "Subway surfers clone.  Three.js JavaScript",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/surfers/";
            },},{id: "projects-swar-composer",
          title: 'Swar Composer',
          description: "Composition software for Hindustani Classical Music, uses Swarlipi notation, MIDI for playback/input, Tabla accompaniment, Raag Database and detection of Raags using N-grams.  VB.NET MIDI",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/swar-composer/";
            },},{id: "projects-synthesia-clone",
          title: 'Synthesia Clone',
          description: "Playable piano with visualization of the notes.  JavaScript Web Audio API",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/synthesia-clone/";
            },},{id: "projects-tetris",
          title: 'Tetris',
          description: "Developed from scratch, a fully-functional Tetris clone. Uses gestures for controls.  Android B4A",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/tetris/";
            },},{id: "projects-top-racer",
          title: 'Top Racer',
          description: "Car racing game inspired by Subway Surfers. High scores, Powerups, Car Showroom.  VB6",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/top-racer/";
            },},{id: "projects-washing-machine-dashboard",
          title: 'Washing Machine Dashboard',
          description: "Users can use this dashboard to check which washing machines are free. Used current sensor (WCS1800).  JavaScript HTML CSS",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/washing-machine-dashboard/";
            },},{id: "projects-wordle",
          title: 'Wordle',
          description: "Wordle clone using pure C. Used ANSI escape codes for colors.  C",
          section: "Projects",handler: () => {
              window.location.href = "/portfolio/projects/wordle/";
            },},{
        id: 'social-email',
        title: 'email',
        section: 'Socials',
        handler: () => {
          window.open("mailto:%73%6F%68%61%6D%6B%6F%72%61%64%65.%6A%6E%76%6B%6B@%67%6D%61%69%6C.%63%6F%6D", "_blank");
        },
      },{
        id: 'social-github',
        title: 'GitHub',
        section: 'Socials',
        handler: () => {
          window.open("https://github.com/sohamkorade", "_blank");
        },
      },{
        id: 'social-linkedin',
        title: 'LinkedIn',
        section: 'Socials',
        handler: () => {
          window.open("https://www.linkedin.com/in/soham-korade", "_blank");
        },
      },{
        id: 'social-orcid',
        title: 'ORCID',
        section: 'Socials',
        handler: () => {
          window.open("https://orcid.org/0009-0005-2518-0313", "_blank");
        },
      },{
        id: 'social-scholar',
        title: 'Google Scholar',
        section: 'Socials',
        handler: () => {
          window.open("https://scholar.google.com/citations?user=S5Iek8wAAAAJ", "_blank");
        },
      },{
        id: 'social-youtube',
        title: 'YouTube',
        section: 'Socials',
        handler: () => {
          window.open("https://youtube.com/@SohamShubhamMusic", "_blank");
        },
      },{
      id: 'light-theme',
      title: 'Change theme to light',
      description: 'Change the theme of the site to Light',
      section: 'Theme',
      handler: () => {
        setThemeSetting("light");
      },
    },
    {
      id: 'dark-theme',
      title: 'Change theme to dark',
      description: 'Change the theme of the site to Dark',
      section: 'Theme',
      handler: () => {
        setThemeSetting("dark");
      },
    },
    {
      id: 'system-theme',
      title: 'Use system default theme',
      description: 'Change the theme of the site to System Default',
      section: 'Theme',
      handler: () => {
        setThemeSetting("system");
      },
    },];
