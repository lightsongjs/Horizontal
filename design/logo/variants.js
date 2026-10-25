// Sursa unică a semnelor: index.html le randează, build-svg.mjs scrie variant-*.svg.
window.HZ_VARIANTS = [
  { id: 'a', name: 'Orizont', bg: '#2F6BFF',
    fg: '<path d="M140 276a116 116 0 0 1 232 0z" fill="#fff"/><rect x="-8" y="312" width="528" height="52" fill="#fff"/>',
    why: 'Un soare care răsare peste linia orizontului, iar linia trece de la o margine la alta a iconiței: numele aplicației, spus fără literă, în albastrul unic al sistemului „Senin”. Două forme pline, deci rămâne citibil la 16px și nu seamănă cu bifele tuturor aplicațiilor de sarcini.' },
  { id: 'b', name: 'Bifa', bg: '#2F6BFF',
    fg: '<circle cx="256" cy="256" r="150" fill="#fff"/><path d="M190 260l46 46 88-96" fill="none" stroke="#2F6BFF" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>',
    why: 'Inelul .ck în starea „gata”, plin, cu bifa decupată: exact controlul pe care omul îl atinge de zeci de ori pe zi. Familiar și calm, dar e și semnul generic al categoriei — riscă să se confunde cu alte liste de sarcini.' },
  { id: 'c', name: 'Straturi', bg: '#FFFFFF',
    fg: '<rect x="96" y="140" width="216" height="60" rx="30" fill="#2F6BFF"/><rect x="164" y="226" width="216" height="60" rx="30" fill="#0E8FB0"/><rect x="232" y="312" width="184" height="60" rx="30" fill="#1F9D60"/>',
    why: 'Trei bare în scară, pe rampa layerelor (albastru → verde): ce poți începe acum, apoi ce urmează. Spune ideea de dependențe, dar pe alb se pierde pe ecranele luminoase și seamănă cu un Gantt oarecare.' },
  { id: 'd', name: 'H pe orizont', bg: '#1A1C20',
    fg: '<rect x="128" y="124" width="80" height="264" rx="40" fill="#fff"/><rect x="304" y="124" width="80" height="264" rx="40" fill="#fff"/><rect x="-8" y="226" width="528" height="60" fill="#5B8DFF"/>',
    why: 'Litera H din două coloane albe, cu bara transversală albastră întinsă de la o margine la alta, ca un orizont: păstrează inițiala de azi, deci tranziția e blândă. Pe fundal închis iese în evidență între iconițe, dar rămâne o literă — mai puțin a noastră decât un semn.' },
];
window.HZ_RECOMMENDED = 'a';
