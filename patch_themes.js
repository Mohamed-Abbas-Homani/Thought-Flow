const fs = require('fs');

let content = fs.readFileSync('src/themes/index.ts', 'utf8');

// Update ThemeTokens interface
content = content.replace(
  /info: string;\n  "info-foreground": string;\n}/,
  'info: string;\n  "info-foreground": string;\n  "chart-bg": string;\n  "chart-node-bg": string;\n  "chart-node-border": string;\n  "chart-edge": string;\n  "chart-text": string;\n}'
);

const chartColors = {
  pluto: {
    dark:  { bg: "#0a0504", nodeBg: "#301808", nodeBorder: "#c07040", edge: "#9a6438", text: "#e8d4a8" },
    light: { bg: "#e8d6c8", nodeBg: "#f6f0e6", nodeBorder: "#c8a878", edge: "#8a5830", text: "#2a1208" }
  },
  moon: {
    dark:  { bg: "#08090e", nodeBg: "#1e2840", nodeBorder: "#8090c8", edge: "#6878a0", text: "#d8e2f4" },
    light: { bg: "#e4e8f4", nodeBg: "#ffffff", nodeBorder: "#4a5ea0", edge: "#6070a0", text: "#1a1e2c" }
  },
  "mother-tree": {
    dark:  { bg: "#080c09", nodeBg: "#1e2c18", nodeBorder: "#b89428", edge: "#7a9860", text: "#c8d8a8" },
    light: { bg: "#dce2d2", nodeBg: "#f2f5ee", nodeBorder: "#7a9828", edge: "#5a7045", text: "#1a2010" }
  },
  owl: {
    dark:  { bg: "#0c0a08", nodeBg: "#2e2616", nodeBorder: "#c49428", edge: "#9a8858", text: "#e8d8b0" },
    light: { bg: "#e8dcc8", nodeBg: "#f8f4ec", nodeBorder: "#b88820", edge: "#7a6848", text: "#241c10" }
  },
  dawn: {
    dark:  { bg: "#100d14", nodeBg: "#3c2438", nodeBorder: "#d06848", edge: "#c08898", text: "#f2d4bc" },
    light: { bg: "#e2d2c1", nodeBg: "#f4ede6", nodeBorder: "#c46040", edge: "#8a6455", text: "#2c1c14" }
  },
  raven: {
    dark:  { bg: "#161824", nodeBg: "#343b58", nodeBorder: "#5b6a9e", edge: "#717a9c", text: "#ced2df" },
    light: { bg: "#e2e4ec", nodeBg: "#ffffff", nodeBorder: "#5b6a9e", edge: "#636a87", text: "#1c1f2b" }
  }
};

for (const [theme, modes] of Object.entries(chartColors)) {
  for (const [mode, colors] of Object.entries(modes)) {
    // We match the specific 'info-foreground' property inside the dark/light block for this theme
    // Since themes are organized as "themeName: { ... dark: { ... info-foreground: "X" } ... light: { ... info-foreground: "Y" } }"
    // We can use a replacer function to accurately substitute
    const blockRegex = new RegExp(`(${theme === 'mother-tree' ? '"mother-tree"' : theme}:.*?${mode}:\\s+\\{[^}]*?)("info-foreground":\\s+"[^"]+",?)(\\s*\\})`, 's');
    content = content.replace(blockRegex, (match, p1, p2, p3) => {
      // p1 is the preamble up to info-foreground
      // p2 is the info-foreground line
      // p3 is the closing bracket
      const newProps = `\n      "chart-bg":             "${colors.bg}",\n      "chart-node-bg":        "${colors.nodeBg}",\n      "chart-node-border":    "${colors.nodeBorder}",\n      "chart-edge":           "${colors.edge}",\n      "chart-text":           "${colors.text}",`;
      
      // Ensure p2 has a comma
      let cleanP2 = p2;
      if (!cleanP2.endsWith(',')) cleanP2 += ',';
      
      return p1 + cleanP2 + newProps + p3;
    });
  }
}

fs.writeFileSync('src/themes/index.ts', content);
console.log('Themes successfully patched with chart colors!');
