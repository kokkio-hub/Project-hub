// Applies the saved light/dark choice before the app loads, to avoid a flash of the wrong theme.
try {
  var theme = localStorage.getItem('ph-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (e) {}
