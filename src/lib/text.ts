// Pliere de diacritice pentru căutare — „firma" trebuie să găsească „Care
// firmă?". Comună între IssueForm (căutarea de dependențe/obstacole) și
// ObstacleForm (căutarea de tichete), ca aceeași regulă să nu fie scrisă de
// două ori. Aceeași idee ca `themeKey` din `src/data/repository.ts`.
export const fold = (v: string): string =>
  v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
