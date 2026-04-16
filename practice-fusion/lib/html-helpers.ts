const POPPINS_STYLE = `<style>@import url('https://fonts.googleapis.com/css2?family=Poppins&display=swap'); body { font-family: 'Poppins', sans-serif; }</style>`;

/**
 * Wraps inner HTML in the standard Poppins-styled section used by full_note_details.
 */
export function wrapHtml(inner: string): string {
    return `${POPPINS_STYLE}<section style='font-size:16px; font-family: Poppins, sans-serif; color:#757575;'>${inner}</section>`;
}
