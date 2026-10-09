// Tema elegido antes de pintar nada (evita el destello del tema equivocado).
// Va en un archivo aparte porque la política de seguridad (CSP) no permite scripts dentro del HTML.
try {
  const t = localStorage.getItem("tema");
  if (t) document.documentElement.dataset.tema = t;
} catch (e) {}
