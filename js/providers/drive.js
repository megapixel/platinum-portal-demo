// drive - DriveSyncProvider interface. The prototype mocks a legacy Google Drive folder per client.
//
// Two ways to handle the existing Drive folders (see ARCHITECTURE.md):
//   1. MIGRATE: copy the files into portal storage once, then retire the folders.
//   2. SYNC METADATA: keep files in Drive and store only links and metadata in the portal.
//
/**
 * interface DriveSyncProvider {
 *   listFolder(caseRec, client): Promise<Array<{ name, mimeType, size }>>;   // files in the case's legacy folder
 * }
 */
export class MockDriveProvider {
  /** A believable legacy folder: three files named the way staff usually name them. */
  async listFolder(caseRec, client) {
    const first = String(client.name).split(' ')[0].toLowerCase();
    return [
      { name: `passport_${first}.pdf`, mimeType: 'application/pdf', size: 210000 },
      { name: `payslips_${first}_6m.pdf`, mimeType: 'application/pdf', size: 480000 },
      { name: `noa_${first}.pdf`, mimeType: 'application/pdf', size: 160000 },
      { name: `scan_0007.pdf`, mimeType: 'application/pdf', size: 90000 },
    ];
  }
}

export class GoogleDriveProvider {
  constructor(config) { this.config = config; }
  async listFolder() {
    // TODO: OAuth with a service account, list the folder by id (parsed from legacyDriveUrl), and stream files into StorageProvider.
    throw new Error('GoogleDriveProvider is not implemented in the prototype.');
  }
}

export const driveSync = new MockDriveProvider();
