/**
 * Headshot geometry shared by the admin editor's cropper and the PDF renderer.
 * Both team layouts frame photos at this portrait ratio, so the crop chosen at
 * upload time is exactly what lands in the exported PDF.
 */
export const HEADSHOT_AR = 6 / 7;
