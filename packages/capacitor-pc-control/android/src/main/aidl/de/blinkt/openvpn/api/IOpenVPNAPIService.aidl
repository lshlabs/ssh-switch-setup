package de.blinkt.openvpn.api;

import android.content.Intent;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import de.blinkt.openvpn.api.APIVpnProfile;
import de.blinkt.openvpn.api.IOpenVPNStatusCallback;

interface IOpenVPNAPIService {
    List<APIVpnProfile> getProfiles();
    void startProfile(String profileUUID);
    boolean addVPNProfile(String name, String config);
    void startVPN(in String inlineconfig);
    Intent prepare(String packagename);
    Intent prepareVPNService();
    void disconnect();
    void pause();
    void resume();
    void registerStatusCallback(in IOpenVPNStatusCallback cb);
    void unregisterStatusCallback(in IOpenVPNStatusCallback cb);
    void removeProfile(String profileUUID);
    boolean protectSocket(in ParcelFileDescriptor fd);
    APIVpnProfile addNewVPNProfile(String name, boolean userEditable, String config);
    void startVPNwithExtras(in String inlineconfig, in Bundle extras);
    APIVpnProfile addNewVPNProfileWithExtras(
        String name,
        boolean userEditable,
        String config,
        in Bundle extras
    );
    @nullable APIVpnProfile getDefaultProfile();
    void setDefaultProfile(String profileUUID);
}
