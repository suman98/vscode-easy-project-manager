import * as os from 'os';
import * as path from 'path';

export function resolvePath(filePath: string): string {
    if (filePath.startsWith('~')) {
        return path.join(os.homedir(), filePath.slice(1));
    }

    return filePath;
}
