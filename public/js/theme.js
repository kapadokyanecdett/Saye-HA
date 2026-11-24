/* ============================================================
   SAYE - Tema on yukleme
   Sayfa boyanmadan once kayitli temayi uygular (FOUC onleme).
   <head> icinde, stil dosyasindan sonra calistirilmalidir.
   ============================================================ */
(function () {
  'use strict';
  try {
    var saved = localStorage.getItem('saye-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {
    /* localStorage erisilemezse varsayilan tema kullanilir */
  }
})();
