# Quality Assessment for riomar-dashboard

An automated assessment of the riomar-dashboard tool based on the EVERSE software quality indicators, run on 2026-03-22.

## General Information

- **Software:** riomar-dashboard
- **Repository:** https://github.com/FAIR2Adapt/riomar-dashboard
- **Assessment date:** 2026-03-22T16:02:25Z
- **Total checks:** 41

## Summary

- **Passed (`true`)**: 21
- **Failed (`false`)**: 19
- **Errors (`error`)**: 1

## Results Table

<table>
  <thead>
    <tr>
      <th>Test ID</th>
      <th>Test Name</th>
      <th>Result</th>
    </tr>
  </thead>
  <tbody>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-01-1</td>
      <td>There is an identifier and resolves</td>
      <td><a href="#persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-01-1">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-01-2</td>
      <td>There is an identifier associated with the software</td>
      <td><a href="#persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-01-2">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-01-3</td>
      <td>Software identifier follows a proper schema</td>
      <td><a href="#persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-01-3">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-03-1</td>
      <td>Software has releases</td>
      <td><a href="#has_releases-https--w3idorg-rsfc-test-rsfc-03-1">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-03-2</td>
      <td>Releases have an id and version number</td>
      <td><a href="#has_releases-https--w3idorg-rsfc-test-rsfc-03-2">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-03-3</td>
      <td>Release versions follow a community established convention</td>
      <td><a href="#versioning_standards_use-https--w3idorg-rsfc-test-rsfc-03-3">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-03-4</td>
      <td>Release identifiers follow the same scheme</td>
      <td><a href="#has_releases-https--w3idorg-rsfc-test-rsfc-03-4">false</a></td>
    </tr>
    <tr style="background-color: #fff3cd;">
      <td>https://w3id.org/rsfc/test/RSFC-03-5</td>
      <td>Last release consistency</td>
      <td><a href="#has_releases-https--w3idorg-rsfc-test-rsfc-03-5">error</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-03-6</td>
      <td>Version number in metadata</td>
      <td><a href="#descriptive_metadata-https--w3idorg-rsfc-test-rsfc-03-6">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-04-1</td>
      <td>Metadata exists</td>
      <td><a href="#descriptive_metadata-https--w3idorg-rsfc-test-rsfc-04-1">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-04-2</td>
      <td>There is a README</td>
      <td><a href="#software_has_documentation-https--w3idorg-rsfc-test-rsfc-04-2">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-04-3</td>
      <td>There are title and description</td>
      <td><a href="#descriptive_metadata-https--w3idorg-rsfc-test-rsfc-04-3">true</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-04-4</td>
      <td>Software has descriptive metadata</td>
      <td><a href="#descriptive_metadata-https--w3idorg-rsfc-test-rsfc-04-4">false</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-04-5</td>
      <td>There is a codemeta file</td>
      <td><a href="#descriptive_metadata-https--w3idorg-rsfc-test-rsfc-04-5">true</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-05-1</td>
      <td>There is a repostatus badge</td>
      <td><a href="#version_control_use-https--w3idorg-rsfc-test-rsfc-05-1">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-05-2</td>
      <td>There is contact and/or support metadata</td>
      <td><a href="#software_has_documentation-https--w3idorg-rsfc-test-rsfc-05-2">false</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-05-3</td>
      <td>Software documentation</td>
      <td><a href="#software_has_documentation-https--w3idorg-rsfc-test-rsfc-05-3">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-06-1</td>
      <td>Authors are declared</td>
      <td><a href="#descriptive_metadata-https--w3idorg-rsfc-test-rsfc-06-1">true</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-06-2</td>
      <td>Contributors are declared</td>
      <td><a href="#descriptive_metadata-https--w3idorg-rsfc-test-rsfc-06-2">false</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-06-3</td>
      <td>Authors have an ORCID</td>
      <td><a href="#descriptive_metadata-https--w3idorg-rsfc-test-rsfc-06-3">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-06-4</td>
      <td>Authors have roles</td>
      <td><a href="#descriptive_metadata-https--w3idorg-rsfc-test-rsfc-06-4">true</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-07-1</td>
      <td>There is an identifier in README or CITATION.cff</td>
      <td><a href="#persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-07-1">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-07-2</td>
      <td>Software identifier resolves to software</td>
      <td><a href="#persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-07-2">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-08-1</td>
      <td>Metadata record in Software Heritage or Zenodo</td>
      <td><a href="#archived_in_software_heritage-https--w3idorg-rsfc-test-rsfc-08-1">false</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-09-1</td>
      <td>Repository is from Github/Gitlab</td>
      <td><a href="#version_control_use-https--w3idorg-rsfc-test-rsfc-09-1">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-12-1</td>
      <td>There is an article citation or reference publication</td>
      <td><a href="#software_has_citation-https--w3idorg-rsfc-test-rsfc-12-1">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-13-1</td>
      <td>Dependencies are declared</td>
      <td><a href="#requirements_specified-https--w3idorg-rsfc-test-rsfc-13-1">true</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-13-2</td>
      <td>There are installation instructions</td>
      <td><a href="#software_has_documentation-https--w3idorg-rsfc-test-rsfc-13-2">false</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-13-3</td>
      <td>Dependencies have version numbers</td>
      <td><a href="#requirements_specified-https--w3idorg-rsfc-test-rsfc-13-3">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-13-4</td>
      <td>There is a dependencies machine-readable file</td>
      <td><a href="#requirements_specified-https--w3idorg-rsfc-test-rsfc-13-4">true</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-14-1</td>
      <td>Presence of tests in repository</td>
      <td><a href="#software_has_tests-https--w3idorg-rsfc-test-rsfc-14-1">false</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-14-2</td>
      <td>There are actions to automate tests</td>
      <td><a href="#repository_workflows-https--w3idorg-rsfc-test-rsfc-14-2">false</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-15-1</td>
      <td>Software has license</td>
      <td><a href="#software_has_license-https--w3idorg-rsfc-test-rsfc-15-1">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-15-2</td>
      <td>License is SPDX compliant</td>
      <td><a href="#software_has_license-https--w3idorg-rsfc-test-rsfc-15-2">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-16-1</td>
      <td>License referenced in metadata files</td>
      <td><a href="#software_has_license-https--w3idorg-rsfc-test-rsfc-16-1">true</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-17-1</td>
      <td>Repository active</td>
      <td><a href="#version_control_use-https--w3idorg-rsfc-test-rsfc-17-1">false</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-17-2</td>
      <td>Commit history</td>
      <td><a href="#version_control_use-https--w3idorg-rsfc-test-rsfc-17-2">true</a></td>
    </tr>
    <tr style="background-color: #f8d7da;">
      <td>https://w3id.org/rsfc/test/RSFC-17-3</td>
      <td>Commits are linked to issues</td>
      <td><a href="#version_control_use-https--w3idorg-rsfc-test-rsfc-17-3">false</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-18-1</td>
      <td>Repository has citation</td>
      <td><a href="#software_has_citation-https--w3idorg-rsfc-test-rsfc-18-1">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-19-1</td>
      <td>Repository has workflows</td>
      <td><a href="#repository_workflows-https--w3idorg-rsfc-test-rsfc-19-1">true</a></td>
    </tr>
    <tr style="background-color: #d4edda;">
      <td>https://w3id.org/rsfc/test/RSFC-20-1</td>
      <td>Repository has an issue tracker</td>
      <td><a href="#support_issue_tracking-https--w3idorg-rsfc-test-rsfc-20-1">true</a></td>
    </tr>
  </tbody>
</table>

## Detailed Results by Indicator

### archived_in_software_heritage

<a id="archived_in_software_heritage-https--w3idorg-rsfc-test-rsfc-08-1"></a>
#### Metadata record in Software Heritage or Zenodo

- **Test ID:** https://w3id.org/rsfc/test/RSFC-08-1
- **Result:** false
- **Process:** Searches for Zenodo and Software Heritage badges in the README file of the repository
- **Evidence:** Could not find neither a Zenodo DOI identifier or a Software Heritage badge in the repository
- **Suggestions:** You should archive your software not only in Github/Gitlab. More information at https://everse.software/RSQKit/archiving_software

### descriptive_metadata

<a id="descriptive_metadata-https--w3idorg-rsfc-test-rsfc-03-6"></a>
#### Version number in metadata

- **Test ID:** https://w3id.org/rsfc/test/RSFC-03-6
- **Result:** true
- **Process:** Checks if a version number for the software is indicated in the CITATION.cff, codemeta.json or package files(i.e. pyproject.toml, pom.xml, etc.)
- **Evidence:** Found the software version in one of the specified files
- **Suggestions:** No suggestions

<a id="descriptive_metadata-https--w3idorg-rsfc-test-rsfc-04-1"></a>
#### Metadata exists

- **Test ID:** https://w3id.org/rsfc/test/RSFC-04-1
- **Result:** true
- **Process:** Searches for codemeta, citation and package files in the repository
- **Evidence:** Found codemeta, citation and package files in the repository
- **Suggestions:** No suggestions

<a id="descriptive_metadata-https--w3idorg-rsfc-test-rsfc-04-3"></a>
#### There are title and description

- **Test ID:** https://w3id.org/rsfc/test/RSFC-04-3
- **Result:** true
- **Process:** Checks if there is a title and a description for the software in the metadata
- **Evidence:** Title and description were found in the repository
- **Suggestions:** No suggestions

<a id="descriptive_metadata-https--w3idorg-rsfc-test-rsfc-04-4"></a>
#### Software has descriptive metadata

- **Test ID:** https://w3id.org/rsfc/test/RSFC-04-4
- **Result:** false
- **Process:** Searches for description, programming languages, date of creation and keywords in the repository
- **Evidence:** Could not find any of the following metadata: keywords
- **Suggestions:** You should describe your software using metadata. More information at https://everse.software/RSQKit/software_metadata

<a id="descriptive_metadata-https--w3idorg-rsfc-test-rsfc-04-5"></a>
#### There is a codemeta file

- **Test ID:** https://w3id.org/rsfc/test/RSFC-04-5
- **Result:** true
- **Process:** Searches for a codemeta.json file in the repository
- **Evidence:** A codemeta.json file was found in the root of the repository
- **Suggestions:** No suggestions

<a id="descriptive_metadata-https--w3idorg-rsfc-test-rsfc-06-1"></a>
#### Authors are declared

- **Test ID:** https://w3id.org/rsfc/test/RSFC-06-1
- **Result:** true
- **Process:** Searches for authors in various files of the repository (i.e. CITATION.cff, AUTHORS.md, codemeta.json)
- **Evidence:** Authors were found in the repository
- **Suggestions:** No suggestions

<a id="descriptive_metadata-https--w3idorg-rsfc-test-rsfc-06-2"></a>
#### Contributors are declared

- **Test ID:** https://w3id.org/rsfc/test/RSFC-06-2
- **Result:** false
- **Process:** Searches for contributors in various files of the repository (i.e. codemeta.json, pyproject.toml, pom.xml)'
- **Evidence:** Found authors but could not find any contributors in the repository
- **Suggestions:** Your software should also document its contributors if there are any. More information at https://everse.software/RSQKit/documenting_software_project

<a id="descriptive_metadata-https--w3idorg-rsfc-test-rsfc-06-3"></a>
#### Authors have an ORCID

- **Test ID:** https://w3id.org/rsfc/test/RSFC-06-3
- **Result:** true
- **Process:** Checks if all authors stated in the CITATION.cff file have an ORCID assigned
- **Evidence:** All authors in the codemeta.json file have an orcid identifier
- **Suggestions:** No suggestions

<a id="descriptive_metadata-https--w3idorg-rsfc-test-rsfc-06-4"></a>
#### Authors have roles

- **Test ID:** https://w3id.org/rsfc/test/RSFC-06-4
- **Result:** true
- **Process:** Checks if all authors stated in a codemeta.json file have a role assigned 
- **Evidence:** All authors defined in the codemeta file have roles assigned
- **Suggestions:** No suggestions

### has_releases

<a id="has_releases-https--w3idorg-rsfc-test-rsfc-03-1"></a>
#### Software has releases

- **Test ID:** https://w3id.org/rsfc/test/RSFC-03-1
- **Result:** false
- **Process:** Searches for release tags in the repository
- **Evidence:** Could not find any releases in the repository
- **Suggestions:** You should often launch releases of your software that contain new updates. More information at https://everse.software/RSQKit/releasing_software

<a id="has_releases-https--w3idorg-rsfc-test-rsfc-03-2"></a>
#### Releases have an id and version number

- **Test ID:** https://w3id.org/rsfc/test/RSFC-03-2
- **Result:** false
- **Process:** Checks if all of the releases have an identifier and a version
- **Evidence:** Could not find any releases in the repository
- **Suggestions:** You should often launch releases of your software that contain new updates. More information at https://everse.software/RSQKit/releasing_software

<a id="has_releases-https--w3idorg-rsfc-test-rsfc-03-4"></a>
#### Release identifiers follow the same scheme

- **Test ID:** https://w3id.org/rsfc/test/RSFC-03-4
- **Result:** false
- **Process:** Checks if all of the version identifiers follow the same scheme
- **Evidence:** Could not find any releases in the repository
- **Suggestions:** You should often launch releases of your software that contain new updates. More information at https://everse.software/RSQKit/releasing_software

<a id="has_releases-https--w3idorg-rsfc-test-rsfc-03-5"></a>
#### Last release consistency

- **Test ID:** https://w3id.org/rsfc/test/RSFC-03-5
- **Result:** error
- **Process:** Checks if the latest release tag matches the version stated in the package file of the repository
- **Evidence:** Could not get the necessary information to perform the test, it being releases and/or version in package file
- **Suggestions:** None

### persistent_and_unique_identifier

<a id="persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-01-1"></a>
#### There is an identifier and resolves

- **Test ID:** https://w3id.org/rsfc/test/RSFC-01-1
- **Result:** false
- **Process:** Searches for an identifier (i.e. DOI or SWHID) in the README file of the repository
- **Evidence:** Could not find any identifier in the repository
- **Suggestions:** You should include a resolvable, unique and persistent identifier in your README file. More information at https://everse.software/RSQKit/software_identifiers

<a id="persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-01-2"></a>
#### There is an identifier associated with the software

- **Test ID:** https://w3id.org/rsfc/test/RSFC-01-2
- **Result:** false
- **Process:** Searches for an identifier in the CITATION.cff, codemeta.json and README files
- **Evidence:** Could not find an identifier in any of the CITATION, codemeta or README files
- **Suggestions:** Remember that identifiers should be included in other files aside from README like codemeta.json, CITATION.cff. More information at https://everse.software/RSQKit/software_identifiers

<a id="persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-01-3"></a>
#### Software identifier follows a proper schema

- **Test ID:** https://w3id.org/rsfc/test/RSFC-01-3
- **Result:** false
- **Process:** Checks if the identifiers associated with the software follow any of these schemas: DOI, URN, GITHUB and SWHID
- **Evidence:** Could not find any identifier in the README file
- **Suggestions:** You should include a resolvable, unique and persistent identifier in your README file. More information at https://everse.software/RSQKit/software_identifiers

<a id="persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-07-1"></a>
#### There is an identifier in README or CITATION.cff

- **Test ID:** https://w3id.org/rsfc/test/RSFC-07-1
- **Result:** false
- **Process:** Searches for an identifier in the README or CITATION.cff files of the repository
- **Evidence:** Could not find an identifier in neither of the README or CITATION files in the repository
- **Suggestions:** You should include your software's identifier in your README or CITATION.cff files. More information at 

<a id="persistent_and_unique_identifier-https--w3idorg-rsfc-test-rsfc-07-2"></a>
#### Software identifier resolves to software

- **Test ID:** https://w3id.org/rsfc/test/RSFC-07-2
- **Result:** false
- **Process:** Checks if the identifier found in the README file or metadata files (i.e. codemeta.json, CITATION.cff) resolves to a page that links back to the software repository
- **Evidence:** Could not find any identifier in the repository
- **Suggestions:** You should include a resolvable, unique and persistent identifier in your README file. More information at https://everse.software/RSQKit/software_identifiers

### repository_workflows

<a id="repository_workflows-https--w3idorg-rsfc-test-rsfc-14-2"></a>
#### There are actions to automate tests

- **Test ID:** https://w3id.org/rsfc/test/RSFC-14-2
- **Result:** false
- **Process:** Searches for workflows that contain test or tests in their names
- **Evidence:** Could not find any workflows or actions that mention test in their names
- **Suggestions:** You should include github actions that run tests to ensure quality. More information at https://everse.software/RSQKit/task_automation_github_actions

<a id="repository_workflows-https--w3idorg-rsfc-test-rsfc-19-1"></a>
#### Repository has workflows

- **Test ID:** https://w3id.org/rsfc/test/RSFC-19-1
- **Result:** true
- **Process:** Searches for workflows in the repository
- **Evidence:** Workflows were found in:
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/.github/workflows/generate-codemeta.yml
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/.github/workflows/deploy.yml
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/.github/workflows/software-fairification-pipeline.yml
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/.github/workflows/lint.yml
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/.github/workflows/fair_assessment.yml
- **Suggestions:** No suggestions

### requirements_specified

<a id="requirements_specified-https--w3idorg-rsfc-test-rsfc-13-1"></a>
#### Dependencies are declared

- **Test ID:** https://w3id.org/rsfc/test/RSFC-13-1
- **Result:** true
- **Process:** Searches for dependencies in project configuration files, README and dependencies files such as requirements.txt
- **Evidence:** Requirements were found in:
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/package.json
- **Suggestions:** No suggestions

<a id="requirements_specified-https--w3idorg-rsfc-test-rsfc-13-3"></a>
#### Dependencies have version numbers

- **Test ID:** https://w3id.org/rsfc/test/RSFC-13-3
- **Result:** true
- **Process:** Checks if all of the dependencies stated in the machine-readable file (e.g. requirements.txt, pyproject.toml, etc.) of the repository have a version indicated
- **Evidence:** All of the dependencies have a version stated
- **Suggestions:** No suggestions

<a id="requirements_specified-https--w3idorg-rsfc-test-rsfc-13-4"></a>
#### There is a dependencies machine-readable file

- **Test ID:** https://w3id.org/rsfc/test/RSFC-13-4
- **Result:** true
- **Process:** Checks if dependencies are indicated in a machine-readable file
- **Evidence:** There is a machine-readable file for dependencies
- **Suggestions:** No suggestions

### software_has_citation

<a id="software_has_citation-https--w3idorg-rsfc-test-rsfc-12-1"></a>
#### There is an article citation or reference publication

- **Test ID:** https://w3id.org/rsfc/test/RSFC-12-1
- **Result:** true
- **Process:** Searches for an article citation or a reference publication in the codemeta and citation files
- **Evidence:** A reference publication was found in the codemeta file of the repository
- **Suggestions:** No suggestions

<a id="software_has_citation-https--w3idorg-rsfc-test-rsfc-18-1"></a>
#### Repository has citation

- **Test ID:** https://w3id.org/rsfc/test/RSFC-18-1
- **Result:** true
- **Process:** Searches for a CITATION.cff file and README file in the repository
- **Evidence:** A citation was found in:
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/CITATION.cff
- **Suggestions:** No suggestions

### software_has_documentation

<a id="software_has_documentation-https--w3idorg-rsfc-test-rsfc-04-2"></a>
#### There is a README

- **Test ID:** https://w3id.org/rsfc/test/RSFC-04-2
- **Result:** true
- **Process:** Searches for a README file in the repository
- **Evidence:** There is a README file in the repository
- **Suggestions:** No suggestions

<a id="software_has_documentation-https--w3idorg-rsfc-test-rsfc-05-2"></a>
#### There is contact and/or support metadata

- **Test ID:** https://w3id.org/rsfc/test/RSFC-05-2
- **Result:** false
- **Process:** Searches for contact and support information in the repository
- **Evidence:** Could not find any of the following information: contact, support, support_channels
- **Suggestions:** You should include contact information in your software's metadata in case someone wants to ask for information.

<a id="software_has_documentation-https--w3idorg-rsfc-test-rsfc-05-3"></a>
#### Software documentation

- **Test ID:** https://w3id.org/rsfc/test/RSFC-05-3
- **Result:** true
- **Process:** Searches for a README file in the root repository and other forms of documentation such as a Read The Docs badge or url
- **Evidence:** Documentation was found in: 	
- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/README.md
- **Suggestions:** No suggest

<a id="software_has_documentation-https--w3idorg-rsfc-test-rsfc-13-2"></a>
#### There are installation instructions

- **Test ID:** https://w3id.org/rsfc/test/RSFC-13-2
- **Result:** false
- **Process:** Searches for installation instructions in the README file of the repository
- **Evidence:** Could not find any installation instructions in the repository
- **Suggestions:** You should include instructions to facilitate the use of your software. More information at https://everse.software/RSQKit/creating_good_readme

### software_has_license

<a id="software_has_license-https--w3idorg-rsfc-test-rsfc-15-1"></a>
#### Software has license

- **Test ID:** https://w3id.org/rsfc/test/RSFC-15-1
- **Result:** true
- **Process:** Searches for a file named 'LICENSE' or 'LICENSE.md' in the root of the repository.
- **Evidence:** A license was found in:
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/package.json
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/LICENSE
	- https://raw.githubusercontent.com/FAIR2Adapt/riomar-dashboard/main/README.md
- **Suggestions:** No suggestions

<a id="software_has_license-https--w3idorg-rsfc-test-rsfc-15-2"></a>
#### License is SPDX compliant

- **Test ID:** https://w3id.org/rsfc/test/RSFC-15-2
- **Result:** true
- **Process:** Checks if the licenses detected are SPDX compliant
- **Evidence:** Licenses are SPDX compliant
- **Suggestions:** No suggestions

<a id="software_has_license-https--w3idorg-rsfc-test-rsfc-16-1"></a>
#### License referenced in metadata files

- **Test ID:** https://w3id.org/rsfc/test/RSFC-16-1
- **Result:** true
- **Process:** Searches for licensing information in the codemeta, citation and package files if they exist
- **Evidence:** License information was found in metadata files
- **Suggestions:** No suggestions

### software_has_tests

<a id="software_has_tests-https--w3idorg-rsfc-test-rsfc-14-1"></a>
#### Presence of tests in repository

- **Test ID:** https://w3id.org/rsfc/test/RSFC-14-1
- **Result:** false
- **Process:** Searches for files and/or directories that mention test in their names
- **Evidence:** Could not find any files or directories that mention test
- **Suggestions:** Your software should include tests to prove its functionability. More information at https://everse.software/RSQKit/testing_software

### support_issue_tracking

<a id="support_issue_tracking-https--w3idorg-rsfc-test-rsfc-20-1"></a>
#### Repository has an issue tracker

- **Test ID:** https://w3id.org/rsfc/test/RSFC-20-1
- **Result:** true
- **Process:** Checks if there is an issue tracker in the repository.
- **Evidence:** Found an issue tracker in the repository
- **Suggestions:** No suggestions

### version_control_use

<a id="version_control_use-https--w3idorg-rsfc-test-rsfc-05-1"></a>
#### There is a repostatus badge

- **Test ID:** https://w3id.org/rsfc/test/RSFC-05-1
- **Result:** false
- **Process:** Searches for a repo status badge in the README file of the repository
- **Evidence:** Could not find a repo status badge in the repository
- **Suggestions:** You should include the state of your repository in the README file

<a id="version_control_use-https--w3idorg-rsfc-test-rsfc-09-1"></a>
#### Repository is from Github/Gitlab

- **Test ID:** https://w3id.org/rsfc/test/RSFC-09-1
- **Result:** true
- **Process:** Checks if the URL provided is indeed a Github or Gitlab repository
- **Evidence:** URL provided is a Github or Gitlab repository
- **Suggestions:** No suggestions

<a id="version_control_use-https--w3idorg-rsfc-test-rsfc-17-1"></a>
#### Repository active

- **Test ID:** https://w3id.org/rsfc/test/RSFC-17-1
- **Result:** false
- **Process:** Checks if there is a repo_status badge with value Active and if there are commits in the repository
- **Evidence:** Could not find a repo status badge in the repository
- **Suggestions:** You should keep your repository active and indicate it with a repostatus badge

<a id="version_control_use-https--w3idorg-rsfc-test-rsfc-17-2"></a>
#### Commit history

- **Test ID:** https://w3id.org/rsfc/test/RSFC-17-2
- **Result:** true
- **Process:** Checks if the software repository has a commits history
- **Evidence:** Commits were found in the repository
- **Suggestions:** No suggestions

<a id="version_control_use-https--w3idorg-rsfc-test-rsfc-17-3"></a>
#### Commits are linked to issues

- **Test ID:** https://w3id.org/rsfc/test/RSFC-17-3
- **Result:** false
- **Process:** Checks if there is at least one of the existing issues (opened or closed) referenced in any of the commits made in the default branch of the repository
- **Evidence:** Could not get the necessary information to perform the test, it being the commits record or repository issues
- **Suggestions:** Don't forget to make commits of your source code to your git repository and issues to improve version control. More information at https://everse.software/RSQKit/using_version_control

### versioning_standards_use

<a id="versioning_standards_use-https--w3idorg-rsfc-test-rsfc-03-3"></a>
#### Release versions follow a community established convention

- **Test ID:** https://w3id.org/rsfc/test/RSFC-03-3
- **Result:** false
- **Process:** Checks if all of the releases versions follow the SemVer or CalVer versioning standards
- **Evidence:** Could not find any releases in the repository
- **Suggestions:** You should often launch releases of your software that contain new updates. More information at https://everse.software/RSQKit/releasing_software
