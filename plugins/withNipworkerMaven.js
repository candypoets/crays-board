const { withProjectBuildGradle } = require('@expo/config-plugins');

const NIPWORKER_MAVEN_URL = 'https://candypoets.github.io/nipworker/';

/**
 * Adds the Maven repository that hosts nipworker's version-matched Android AAR.
 * Keeping this in a config plugin makes `expo prebuild --clean` safe.
 */
module.exports = function withNipworkerMaven(config) {
  return withProjectBuildGradle(config, (project) => {
    if (project.modResults.language !== 'groovy') {
      throw new Error('withNipworkerMaven currently expects a Groovy project build.gradle');
    }

    if (project.modResults.contents.includes(NIPWORKER_MAVEN_URL)) {
      return project;
    }

    const repositoriesBlock = /allprojects\s*\{\s*repositories\s*\{/;
    if (!repositoriesBlock.test(project.modResults.contents)) {
      throw new Error('Could not find the Android allprojects repositories block');
    }

    project.modResults.contents = project.modResults.contents.replace(
      repositoriesBlock,
      (match) => `${match}\n        maven {\n            url = uri(System.getenv("NIPWORKER_MAVEN_URL") ?: "${NIPWORKER_MAVEN_URL}")\n        }`,
    );

    return project;
  });
};
