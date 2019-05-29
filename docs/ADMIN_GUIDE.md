# Open Science Data Framework (OSDF) Admin Guide

<a name="top"></a>

***

## Contents

* [Dependencies](#dependencies)
* [Installation](#installation)
* [Configuration](#config)
* [Launching OSDF](#launching)
* [User & Group Management](#user_mgmt)
* [Adding namespaces](#namespaces)
* [Securing OSDF with SSL/TLS](#tls)
* [Testing](#testing)

## <a name="dependencies"></a> Dependencies

The reference implementation of OSDF has several dependencies that are
required to be installed. These are:

* Node.js (version 8.x or above)
* CouchDB (1.6 or above)
* ElasticSearch 1.7

It should be noted, that versions of ElasticSearch that are beyond 2.x are
unlikely to work properly. This is due to the fact that OSDF currently
requires a CouchDB to ElasticSearch river to keep the ElasticSearch indices
up-to-date. ElasticSearch has removed the "river" feature that they supported
for several years in ElasticSearch 2.0 and above. We expect that a future
version of OSDF will work around this limitation so that more recent versions
of ElasticSearch will be compatible with OSDF. ElasticSerach 1.X binaries and
downloads are available from the elastic.com website.

## <a name="installation"></a> Installation

OSDF can more easily be installed using the pre-built packages for
Debian/Ubuntu that can be obtained from the OSDF website at
osdf.igs.umaryland.edu. However, if one wishes to install OSDF using the
source code obtained from GitHub, simply download the latest release (from
the GitHub repository's "Releases" tab) and unpack the distribution in the
desired location on the machine one wishes to operate OSDF from. There are a
number of files and directories, but among the more important of these, one
can immediately see a "conf" directory, a "working" directory, and a "bin"
directory.

Next, one may notice that there is an empty "node_modules" directory. This
directory will contain all there various Node.js library and dependencies
that OSDF needs to do its job. These dependencies, and their version numbers
are listed in the projects package.json, which is a standard common to
node.js software projects. To install the dependencies, once simply executes

    $ npm install

Depending on the performance of one's internet connection, the above may take
just a few moments, to several minutes, to complete.

For a basic installation, OSDF administrators can use the default layout
that is provided when OSDF is untarred/uncompressed from the release file.
That is, administrators can elect to use the provided "working" and "conf"
directories. However, when launching OSDF, there are command line options to
control the path to alternate locations for these if customization is
desired.

[top](#top)

***

## <a name="config"></a> Configuration

The "conf" directory contains the configuration file called config.ini. There
is also a config.ini.sample with some example values. These files should
already be well commented with a brief explanation about what each parameter
does and how it influences the operation of OSDF. Perhaps the most important
configuration parameters are those that configure the connections to CouchDB
and ElasticSearch. For each of these connections, the hostname (or IP address)
and the port number will be required. Alter the "couch_address" parameter to
contain the hostname or IP address of your CouchDB server and the "couch_port"
parameter to contain the TCP port number that your CouchDB server is listening
on. For CouchDB, the default port is 5984. Typically, you will want your CouchDB
to have authentication enabled for enhanced security, so use the "couch_user"
and "couch_pass" parameter to configure the username and password that OSDF
will connect to CouchDB with.

In the [elasticsearch] section of the configuration file, there are similar
parameters to configure the ES connection. Use "elasticsearch_address" to
specify you ES hostname and "elasticsearch_port" to specify the TCP port number.
ElasticSearch's default port number is 9200.

Further down in the configuration file, there is an [info] section. Basic
information about the OSDF instance, such as a description, contact
information, can be set here for retrieval via users of the API. Note that
the title, comment1 and comment2 fields are limited to 128 characters, while
the "description" field may contain up to 512 characters. For the contact
email fields, it is recommended that real working addresses be used for the
benefit of the OSDF instance's end users.

[top](#top)

## <a name="launching"></a> Launching OSDF

To launch OSDF, one must ensure that the current directory, and the
installation's /lib directory are included in the NODE_PATH environment
variable. Node.js needs to be able to load files and libraries in both
directories for OSDF to run successfully. If one is using the bash shell in
linux, simply execute

    $ export NODE_PATH=.:./lib

while in the root directory of the OSDF installation. For other shells, or
operating systems, please consult the appropriate documentation for how to
set an environment variable such as "NODE_PATH".

Then, launch OSDF by executing the osdf.js file:

    $ node osdf.js

Some diagnostic information is printed to the terminal window, such as the
number of users detected, what the OSDF_ROOT directory is, how many CPUs (or
cores) Node.js will be using for OSDF and other details. If OSDF starts
correctly without errros, one will see a message that looks like
this:

    ===============================================
    Welcome to
      ____  _______  ____
     / __ \/ __/ _ \/ __/
    / /_/ /\ \/ // / _/
    \____/___/____/_/


    Open Science Data Framework

    ===============================================

[top](#top)

## <a name="user_mgmt"></a> User & Group Management

The authorized users for this reference implementation of OSDF are found in
a file in the OSDF "working" directory. By default, the OSDF working directory
is simply the "working" directory in the root of the OSDF installation. Under
that directory, there is a file called users.db that lists the valid users for
the OSDF instance. The format of the file is simple:

    username:hashed_password

For example:

    test:sha1$d7e6a336$1$d96d61f49ed32e79cf9ed90402d691d85d197fff

The password is salted and hashed to prevent the password from being exposed
"in the clear". A discussion about the merits of such a scheme is beyond the
scope of this guide, but this scheme allows for ease of administration and
yet remain relatively secure. To add users to OSDF, one would simply need to
add a new line to the users.db file along with the corresponding hashed
password. To aid in this process, OSDF comes bundled with a utility script
found in the "bin" directory: generate_password_hash.js. Invoking
generate_password_hash.js requires the username that the hash should be
generated for. The password itself is entered interactively in a manner that
does not echo it to the terminal window (for security). A brief example
follows:

    $ cd bin

    $ ./generate_password_hash.js --username cool_user

    Enter the password (not echoed):
    Confirm your password (not echoed):
    cool_user:sha1$9c9c6c37$1$a4cb0bb268696743921e56e11503e38984a6789b

The last line of output is the line one should add to the users.db file.

Changes to the users.db file generally are not picked up unless an OSDF
server restart is performed, but once done, the new user should be able
to authenticate to the server to at least retrieve the OSDF instance's
information endpoint:

    $ curl -X GET -u cooluser:test http://X.X.X.X:8123/info

where "X.X.X.X" is the OSDF server's IP address or hostname.

Now that the user has been added to the system, an OSDF administrator
may also wish to add the user to one or more groups in a namespace, or
namespaces. Namespaces are also stored in the OSDF working directory.
in a "namespaces" directory.

The organizational structure should look like this:

    working
    └── namespaces
        ├── ns1
        │   ├── acls
        │   ├── aux
        │   └── schemas
        └── ns2
        │   ├── acls
        │   ├── aux
        │   └── schemas
        └── nsN
            ├── acls
            ├── aux
            └── schemas

Each namespace has its own directory, and each one should have an "acls"
(ACL=Access Control List) directory. In the "acls" directory, administrators
can place a file where the name of the file will be interpreted as the name of a
group in OSDF, and the file may contain usernames/accounts that are to be
members of the group. For instance, bundled with the reference OSDF
implementation is a namespace called "test". The "test" namespace's "acls"
directory has 3 files in it: managers, executives, and associates. Therefore,
there are 3 acls for the "test" namespace. Each of these files contains the
membership of those acls, one account/username per line.

[top](#top)

### <a name="namespaces"></a> Adding namespaces

There is a utility script located in the /bin directory called "new_namespace".
This script can be used to generate the file and directory structure that
is needed for a correctly configured namespace in the OSDF reference
implementation. Basically, the structure looks like this:

    test2/
    ├── acls
    │   ├── associates
    │   ├── executives
    │   └── managers
    ├── aux
    │   └── color.json
    ├── info.json
    ├── linkage.json
    └── schemas
        ├── anylinkage.json
        ├── example.json
        └── target.json

In this case, "test2" is the namespace name, and this directory is located
insdie the working/namespaces directory. From there, there are 3 subdirectories:
"acls" contain group names used by the OSDF api, and each of these files, named
after the group they describe, has a group membership listing with a username
on each line of the file.

The "schemas" directory contains the JSON-Schema files that impose validation
rules for the various node_types. For example, example.json provides the schema
for nodes of type "example".

The "aux" directory contains auxiliary schemas that the base schemas may use
in a repeatable way by using the "$ref" construct that JSON-Schema provides.
This technique help prevent duplication of code.

The info.json file simply contains metadata information about the namespace
itself, and has a field for the namesspace title, description, and a URL.

Finally, linkage.json is an optional file for a namepsace. However, if it is
present, this file contains data about what connections may be created between
nodes of various types for this particular namespace. An open-ended linkage.json
file would look like

    "*": {
      "*": [ "*" ]
    }

which basically means that any node can connect to any other node, with any
linkage name (edge name). A more restrictive example would something like

    "example": {
        "related_to": [ "target" ]
    },
    "*": {
      "*": [ "*" ]
    }

which can be interpreted as "nodes of type 'example' can only be linked to
nodes of type 'target' and the linkage name must be 'related_to'.". More
detailed examples are provided in the OSDF reference implementation's "test2"
namespace.

[top](#top)

## <a name="tls"></a> Securing OSDF with SSL/TLS

The OSDF reference implementation can be operated with SSL/TLS for improved
security by using encrypted communications. A description of how TLS works
is beyond the scope of this guide, but three files are needed to configure
TLS in OSDF: a certificate file, a key file and a certificate authority (CA)
file. These can be obtained from a 3rd party vendor, or also self-generated
by developers and organizations of they choose to go that route. In general
3rd party vendors provide certificates that are better trusted by end-user
tools than self-generated, or self-signed, certificates.

Once these three files are obtained, the paths to their locations on the OSDF
server must be specified in the config.ini file. The relevant configuration
parameters are: cert_file, key_file, and ca_file. In addition, the
https_enabled configuration parameter must also be set to "true" for these
settings to have any effect, otherwise, the OSDF system will completely
ignore their values.

[top](#top)

### <a name="testing"></a> Testing

Modern open-source software projects should contain special scripts and
testing procedures to aid in the software development process and to identify
and prevent regressions when making alterations and improvements to the code.
OSDF's test scripts are in the "test" subdirectory. The test scripts are
written using the Mocha testing framework for JavaScript and also with the
Chai library to make tests more expressive. Launching the tests, one can
simply execute

    $ mocha test

to run all of the tests in the test directory, or to launch an individual test

    $ mocha test/node-retrieve.js

Note: The package.json file also has a "test" in the "scripts" key of the file,
so one can also launch mocha like so:

    $ npm test

The latter technique has the benefit of looking for the 'mocha' executable
under the node_modules subdirectory. Otherwise, one would need to ensure that
either mocha is installed separately and in one's PATH, or the full path to
mocha in the node_modules directory would need to be specified.

Invoking the testing framework will run the specified tests (or all the
tests) against a live OSDF instance (the one under test) for compliance with
the published API. However, the test code needs to determine where on the
network the OSDF instance is to be found. This is accomplished with a
dedicated configuration file: test_config.ini. This is an INI style
configuration file that must adhere to the following format:

    [osdf]
    host=X.X.X.X
    port=8123
    username=USERNAME
    password=PASSWORD

Replace X.X.X.X with the IP address or hostname of the OSDF server you wish
to test. Replace 8123, with the specific port number of your OSDF server
(8123 is the default). Finally, specify the real username and password to use
in those fields. The file simply needs to be present somewhere in the
NODE_PATH so that node.js's require() call will find it when the tests are
executed.

[top](#top)
