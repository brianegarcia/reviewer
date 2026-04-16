import User from "@models/user.model";
import { UserRoleEnum, UserStatusEnum } from "@utils/enum";
import { ORGANIZATION_ID, TSV_FILES, DEFAULT_PASSWORD, PROVIDER_EMAILS } from "../config";
import { parseTsvFile, TsvRow } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";

const CTX = "phase1/providers";

export async function importProviders(): Promise<{ providerMap: IdMap; profileMap: IdMap; userMap: IdMap }> {
    const providerMap = new IdMap("provider-map");
    const profileMap = new IdMap("profile-map");
    const userMap = new IdMap("user-map");

    logger.info(CTX, "Starting providers import...");

    // Read all 3 provider-related TSVs
    const providers = await parseTsvFile(TSV_FILES.providers);
    const profiles = await parseTsvFile(TSV_FILES.providerProfiles);
    const users = await parseTsvFile(TSV_FILES.users);

    logger.info(CTX, `Found ${providers.length} providers, ${profiles.length} profiles, ${users.length} users`);

    let imported = 0;
    let updated = 0;
    let errored = 0;

    for (const provider of providers) {
        const providerGuid = provider.ProviderGuid;
        if (!providerGuid) {
            logger.warn(CTX, "Provider missing ProviderGuid, skipping");
            errored++;
            continue;
        }

        try {
            // Find matching email from config or generate placeholder
            const email =
                PROVIDER_EMAILS[providerGuid] ||
                `${(provider.FirstName || "unknown").toLowerCase()}.${(provider.LastName || "unknown").toLowerCase()}@placeholder.subqdocs.com`;

            // Check if already imported
            const existing = await User.findOne({
                where: { third_party_id: providerGuid, organization_id: ORGANIZATION_ID },
            });

            if (existing) {
                providerMap.set(providerGuid, existing.id);
                logger.info(CTX, `Provider "${provider.FirstName} ${provider.LastName}" already exists (id=${existing.id})`);
                updated++;
            } else {
                // Create user — password will be hashed by @BeforeCreate hook
                const user = await User.create({
                    third_party_id: providerGuid,
                    organization_id: ORGANIZATION_ID,
                    first_name: provider.FirstName || "Unknown",
                    last_name: provider.LastName || "Unknown",
                    title: provider.Title || null,
                    email,
                    password: DEFAULT_PASSWORD,
                    role: UserRoleEnum.DOCTOR,
                    status: UserStatusEnum.ACTIVE,
                    is_admin: true,
                    data_source: "local",
                } as any);

                providerMap.set(providerGuid, user.id);
                imported++;
                logger.info(CTX, `Imported provider: "${provider.FirstName} ${provider.LastName}" -> id=${user.id}`);
            }

            const userId = providerMap.get(providerGuid)!;

            // Map ProfileGuid -> same user ID
            const matchingProfile = profiles.find(
                (p: TsvRow) =>
                    p.FirstName === provider.FirstName && p.LastName === provider.LastName
            );
            if (matchingProfile?.ProfileGuid) {
                profileMap.set(matchingProfile.ProfileGuid, userId);
            }

            // Map UserGuid -> same user ID
            const matchingUser = users.find(
                (u: TsvRow) =>
                    u.FirstName === provider.FirstName && u.LastName === provider.LastName
            );
            if (matchingUser?.UserGuid) {
                userMap.set(matchingUser.UserGuid, userId);
            }
        } catch (err: any) {
            logger.error(CTX, `Provider ${providerGuid}: ${err.message}`);
            errored++;
        }
    }

    providerMap.save();
    profileMap.save();
    userMap.save();
    logger.summary(CTX, { imported, updated, skipped: 0, errored, total: providers.length });

    return { providerMap, profileMap, userMap };
}
