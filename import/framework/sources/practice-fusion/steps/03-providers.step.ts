/**
 * Step 03 – Providers → users
 *
 * Practice Fusion has three provider-related files:
 *   providers.tsv      → each becomes a user row (role = doctor)
 *   provider-profiles.tsv → ProfileGuid mapped to the same user by name match
 *   users.tsv          → UserGuid mapped to the same user by name match
 *
 * All three GUIDs are registered in context.lookups["provider"] so any step
 * that needs to resolve a provider by any of its GUIDs can do so.
 *
 * Natural key: third_party_id (ProviderGuid) + organization_id
 *
 * NOTE: Passwords are stored as plain-text here; the application's
 * @BeforeCreate hook or the first-login flow must hash them.
 * The SQL emits a comment reminding the DBA to run the hashing step.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfProviderRow, PfProviderProfileRow, PfUserRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { getPfExtra } from "../config";
import { sqlLiteral } from "../../../core/sql-builder";

export class ProvidersStep extends BasePfStep {
  readonly name = "03-providers";
  readonly phase = 1;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const extra = getPfExtra(ctx.config);
    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;

    const providers = (await this.loadFile(ctx, "providers")) as PfProviderRow[];
    const profiles = (await this.loadFile(ctx, "providerProfiles")) as PfProviderProfileRow[];
    const users = (await this.loadFile(ctx, "users")) as PfUserRow[];

    ctx.logger.info(this.name, `${providers.length} providers, ${profiles.length} profiles, ${users.length} users`);

    let generated = 0;
    let skipped = 0;

    this.emit(ctx, {
      sql: "-- IMPORTANT: After running this file, hash provider passwords:\n" +
           "--   UPDATE users SET password = crypt(password, gen_salt('bf')) WHERE data_source = 'local' AND role = 'doctor';\n" +
           "-- Or trigger the application's password migration flow for each provider.",
    });

    for (let i = 0; i < providers.length; i++) {
      const prov = providers[i];
      const guid = prov.ProviderGuid;
      const firstName = emptyToNull(prov.FirstName) ?? "Unknown";
      const lastName = emptyToNull(prov.LastName) ?? "Unknown";

      if (!guid) {
        errors.push({ step: this.name, rowIndex: i, field: "ProviderGuid", message: "ProviderGuid is required" });
        skipped++;
        continue;
      }

      const email =
        extra.providerEmails[guid] ??
        `${firstName.toLowerCase()}.${lastName.toLowerCase()}@placeholder.subqdocs.com`;

      this.emit(ctx, {
        table: "users",
        data: {
          third_party_id: guid,
          organization_id: raw(orgIdExpr),
          first_name: firstName,
          last_name: lastName,
          title: emptyToNull(prov.Title),
          email,
          // Password stored in plain text – must be hashed before use (see comment above)
          password: extra.defaultPassword,
          role: "doctor",
          status: "active",
          is_admin: true,
          data_source: "local",
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["third_party_id", "organization_id"],
        updateColumns: ["first_name", "last_name", "title", "email", "updated_at"],
        comment: `Provider: ${firstName} ${lastName} (${guid})`,
      });

      // Register all three GUID forms in context.lookups
      ctx.lookups.set("provider", guid, guid);

      // ProfileGuid → same provider GUID (match by name)
      const matchProfile = profiles.find(
        (p: PfProviderProfileRow) => p.FirstName === prov.FirstName && p.LastName === prov.LastName
      );
      if (matchProfile?.ProfileGuid) {
        ctx.lookups.set("provider", matchProfile.ProfileGuid, guid);
        ctx.lookups.set("providerByProfile", matchProfile.ProfileGuid, guid);
      }

      // UserGuid → same provider GUID (match by name)
      const matchUser = users.find(
        (u: PfUserRow) => u.FirstName === prov.FirstName && u.LastName === prov.LastName
      );
      if (matchUser?.UserGuid) {
        ctx.lookups.set("provider", matchUser.UserGuid, guid);
      }

      generated++;
    }

    return this.result(providers.length, generated, skipped, errors);
  }
}
