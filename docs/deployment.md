# Production deployment

Debt Finder and its configuration are development tooling. Keep the shared configuration and package files in source control.

The consuming project's build or deployment pipeline should exclude the configuration from final production artifacts and omit development dependencies from the final runtime installation. Keep both the tool and its configuration available in development and CI jobs that run Debt Finder.

Git ignore rules control source tracking, not deployment. Omitting development dependencies does not automatically remove the configuration file from an artifact. Existing build systems may already provide these exclusions; setup cannot configure every deployment system automatically.
