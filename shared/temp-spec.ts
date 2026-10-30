/**
 * Specs Claude writes only to look at the site (print the page's controls, try a flow) and not to
 * keep. They sit in the same folder as the real ones, so the cases page tells them apart by name.
 * `zz-probe-` is the name Claude is asked to use; the others catch what it names them anyway.
 */
const TEMPORARY = /^zz-probe-|(?:^|[-_.])(?:scratch|tmp|temp|debug|sandbox)(?:[-_.]|$)/i;

export const isTemporarySpec = (file: string): boolean => TEMPORARY.test(file.split(/[\\/]/).pop() ?? file);
